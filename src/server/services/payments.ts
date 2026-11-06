import { handleRazorpayOrderEvent } from "@/server/services/online-payments";
import "server-only";
import { alias } from "drizzle-orm/pg-core";
import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db/client";
import { paymentEvents, payments, sales, users, customers, saleReturns } from "@/server/db/schema";
import { audit, SYSTEM_ACTOR } from "@/server/audit";
import { auditActorOf, can, requirePermission, type Actor } from "@/server/auth/actor";
import { conflict, forbidden, invalid, notFound, precondition } from "@/server/errors";
import { getSettings } from "@/server/settings";
import {
  createRazorpayCollection,
  createStaticUpiCollection,
  parseRazorpayEvent,
  razorpayConfigFromEnv,
  verifyRazorpaySignature,
  type NormalizedPaymentEvent,
} from "@/server/payments/providers";
import { isValidUpiUtr } from "@/lib/india";
import { D, formatINR, m } from "@/lib/money";
import { PAYMENT_METHOD_LABEL } from "@/lib/bill-layout";

export type Payment = typeof payments.$inferSelect;
type Method = Payment["method"];

async function lockSale(tx: Tx, saleId: string) {
  const [s] = await tx.select().from(sales).where(eq(sales.id, saleId)).for("update");
  if (!s || s.deletedAt) throw notFound("Sale");
  return s;
}

function canSeeSale(actor: Actor, sale: { createdBy: string }) {
  return sale.createdBy === actor.id || can(actor, "sales.view_all");
}

/** Total credited back via credit notes (returns) for a sale. */
export async function creditedTotal(tx: Tx, saleId: string) {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${saleReturns.grandTotal}), 0)::text` })
    .from(saleReturns)
    .where(eq(saleReturns.saleId, saleId));
  return D(row?.total ?? 0);
}

/** What the customer still owes: agreed total − credit notes − (received − refunded). */
export async function outstandingFor(tx: Tx, sale: { id: string; grandTotal: string; amountPaid: string; amountRefunded: string }) {
  const credited = await creditedTotal(tx, sale.id);
  return D(sale.grandTotal).minus(credited).minus(D(sale.amountPaid).minus(D(sale.amountRefunded)));
}

/** Recompute paid/refunded totals and payment status from the payment ledger. */
export async function recomputeSalePayments(tx: Tx, saleId: string) {
  const rows = await tx
    .select({ direction: payments.direction, amount: payments.amount })
    .from(payments)
    .where(and(eq(payments.saleId, saleId), eq(payments.status, "successful")));
  const paid = rows.filter((r) => r.direction === "in").reduce((a, r) => a.plus(D(r.amount)), D(0));
  const refunded = rows.filter((r) => r.direction === "refund").reduce((a, r) => a.plus(D(r.amount)), D(0));
  const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId));
  const netDue = D(sale.grandTotal).minus(await creditedTotal(tx, saleId));
  let status: typeof sales.$inferSelect.paymentStatus;
  if (refunded.greaterThan(0) && refunded.greaterThanOrEqualTo(paid)) status = "refunded";
  else if (refunded.greaterThan(0)) status = "partially_refunded";
  else if (paid.greaterThanOrEqualTo(netDue) && paid.greaterThan(0)) status = "paid";
  else if (paid.greaterThan(0)) status = "partially_paid";
  else status = "unpaid";
  await tx
    .update(sales)
    .set({ amountPaid: m(paid), amountRefunded: m(refunded), paymentStatus: status, updatedAt: new Date() })
    .where(eq(sales.id, saleId));
  return { paid, refunded, status };
}

function assertPayable(sale: typeof sales.$inferSelect) {
  if (sale.status === "draft") throw precondition("Finalise the sale (agree the amount) before taking payment");
  if (sale.status === "cancelled") throw conflict("This sale was cancelled");
}

/* ------------------------------------------------------------------ */
/* Collect via QR                                                      */
/* ------------------------------------------------------------------ */

export async function startUpiPayment(actor: Actor, saleId: string, amountInput?: string | null) {
  requirePermission(actor, "payments.record");
  const cfg = await getSettings("payments");
  const business = await getSettings("business");
  const db = getDb();
  return db.transaction(async (tx) => {
    const sale = await lockSale(tx, saleId);
    if (!canSeeSale(actor, sale)) throw forbidden();
    assertPayable(sale);
    const outstanding = await outstandingFor(tx, sale);
    if (outstanding.lessThanOrEqualTo(0)) throw conflict("Nothing is outstanding on this sale");
    const amount = amountInput ? D(amountInput) : outstanding;
    if (amount.lessThanOrEqualTo(0) || amount.greaterThan(outstanding)) {
      throw invalid(`Amount must be between ₹0.01 and the outstanding ₹${m(outstanding)}`);
    }
    if (amount.greaterThan(D(cfg.maxPerUpiPayment))) {
      throw invalid(`UPI payments are limited to ₹${m(cfg.maxPerUpiPayment)} each — split the payment`);
    }

    const useGateway = cfg.gatewayProvider === "razorpay" && !!razorpayConfigFromEnv();
    if (!useGateway && !cfg.upiEnabled) throw precondition("UPI QR is not configured. Ask the Super Admin to set the shop's UPI ID.");

    // Reuse an identical, still-valid QR instead of creating confusing duplicates.
    const now = new Date();
    const open = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.saleId, saleId), eq(payments.method, "upi"), eq(payments.status, "initiated")));
    const reusable = open.find((p) => D(p.amount).equals(amount) && p.expiresAt && p.expiresAt > now && p.provider === (useGateway ? "razorpay" : "upi_static"));
    if (reusable) return reusable;

    const expiresAt = new Date(now.getTime() + cfg.qrExpiryMinutes * 60_000);
    const [row] = await tx
      .insert(payments)
      .values({
        saleId,
        direction: "in",
        method: "upi",
        provider: useGateway ? "razorpay" : "upi_static",
        amount: m(amount),
        status: "pending",
        expiresAt,
        createdBy: actor.id,
      })
      .returning();

    const req = { paymentId: row.id, saleNumber: sale.saleNumber, amount: m(amount), expiresAt, payeeName: business.name };
    const collection = useGateway
      ? await createRazorpayCollection(req, razorpayConfigFromEnv()!)
      : createStaticUpiCollection(req, { vpa: cfg.upiVpa, payeeName: cfg.upiPayeeName, merchantCode: cfg.upiMerchantCode });

    const [updated] = await tx
      .update(payments)
      .set({
        status: "initiated",
        qrPayload: collection.qrPayload,
        providerOrderId: collection.providerOrderId,
        expiresAt: collection.expiresAt,
        providerData: { ...(collection.providerData ?? {}), qrImageUrl: collection.qrImageUrl, autoVerify: collection.autoVerify, instructions: collection.instructions },
        updatedAt: new Date(),
      })
      .where(eq(payments.id, row.id))
      .returning();
    await audit(tx, auditActorOf(actor), {
      action: "payment.qr_generated",
      entityType: "sale",
      entityId: saleId,
      summary: `Generated ${useGateway ? "Razorpay" : "UPI"} QR for ₹${m(amount)} on ${sale.saleNumber}`,
      data: { paymentId: row.id, amount: m(amount), provider: updated.provider, expiresAt: updated.expiresAt },
    });
    return updated;
  });
}

/* ------------------------------------------------------------------ */
/* Manual verification                                                 */
/* ------------------------------------------------------------------ */

export interface ManualPaymentInput {
  method: Method;
  amount: string;
  /** UTR / UPI ref / card approval code / cheque no. */
  reference?: string | null;
  tenderedAmount?: string | null;
  verificationMethod: NonNullable<Payment["verificationMethod"]>;
  note?: string | null;
  /** Confirm an existing QR intent instead of creating a new record. */
  paymentId?: string | null;
  /** Operator must explicitly confirm they saw the money. */
  confirmReceived: boolean;
}

export async function recordVerifiedPayment(actor: Actor, saleId: string, input: ManualPaymentInput) {
  requirePermission(actor, "payments.verify");
  if (!input.confirmReceived) {
    throw invalid("Confirm that you have checked the merchant app / bank / cash and the money was received");
  }
  if (input.verificationMethod === "gateway_webhook" || input.verificationMethod === "gateway_api") {
    throw invalid("Gateway verification cannot be recorded manually");
  }
  const cfg = await getSettings("payments");
  const enabled: Record<Method, boolean> = {
    upi: cfg.upiEnabled || cfg.gatewayProvider !== "none",
    cash: cfg.cashEnabled,
    card: cfg.cardEnabled,
    bank_transfer: cfg.bankTransferEnabled,
    cheque: cfg.chequeEnabled,
    other: false,
  };
  if (!enabled[input.method]) throw precondition(`${input.method} payments are not enabled in settings`);
  const amount = D(input.amount);
  if (amount.lessThanOrEqualTo(0) || amount.decimalPlaces() > 2) throw invalid("Enter a valid amount");
  const reference = input.reference?.trim() || null;

  // Method-specific evidence rules
  switch (input.method) {
    case "upi":
      if (cfg.requireUpiReference && (!reference || !isValidUpiUtr(reference))) {
        throw invalid("Enter the 12-digit UTR / UPI Ref. No. shown in the merchant app");
      }
      if (!["manual_merchant_app", "manual_bank_statement"].includes(input.verificationMethod)) {
        throw invalid("UPI payments must be verified in the merchant app or bank statement");
      }
      break;
    case "cash":
      if (input.verificationMethod !== "cash_counted") throw invalid("Cash must be counted at the counter");
      if (input.tenderedAmount && D(input.tenderedAmount).lessThan(amount)) throw invalid("Cash tendered is less than the amount");
      break;
    case "bank_transfer":
    case "cheque":
      if (!reference || reference.length < 4) throw invalid("Enter the transfer / cheque reference");
      if (input.verificationMethod !== "manual_bank_statement") throw invalid("Confirm against the bank statement");
      break;
    case "card":
      if (!reference || reference.length < 4) throw invalid("Enter the card terminal approval code");
      break;
  }

  const db = getDb();
  return db.transaction(async (tx) => {
    const sale = await lockSale(tx, saleId);
    if (!canSeeSale(actor, sale)) throw forbidden();
    assertPayable(sale);
    const outstanding = await outstandingFor(tx, sale);
    if (amount.greaterThan(outstanding)) {
      throw invalid(`Amount exceeds the outstanding ₹${m(outstanding)}${input.method === "cash" ? " — enter the bill amount and the cash tendered separately" : ""}`);
    }
    const now = new Date();
    let row: Payment;
    if (input.paymentId) {
      const [intent] = await tx.select().from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.saleId, saleId))).for("update");
      if (!intent) throw notFound("Payment request");
      if (intent.status !== "initiated" && intent.status !== "pending") throw conflict(`This payment is already ${intent.status}`);
      if (intent.direction !== "in") throw invalid("Only incoming payment requests can be confirmed here");
      // A QR request can only be confirmed with its own method's evidence (a UPI QR needs its UTR).
      // Money received another way is recorded as a separate payment after closing the QR.
      if (intent.method !== input.method) {
        throw invalid(`This is a ${intent.method.toUpperCase()} payment request. Confirm it as ${intent.method.toUpperCase()}, or close it and record the ${input.method.replace("_", " ")} payment separately.`);
      }
      if (!D(intent.amount).equals(amount)) {
        throw invalid(`The QR was for ₹${intent.amount}. If a different amount was received, record it as a separate payment.`);
      }
      [row] = await tx
        .update(payments)
        .set({
          status: "successful",
          reference,
          verificationMethod: input.verificationMethod,
          verifiedBy: actor.id,
          verifiedAt: now,
          receivedAt: now,
          verificationNote: input.note ?? null,
          updatedAt: now,
        })
        .where(eq(payments.id, intent.id))
        .returning();
    } else {
      [row] = await tx
        .insert(payments)
        .values({
          saleId,
          direction: "in",
          method: input.method,
          provider: input.method === "upi" ? "upi_static" : "manual",
          amount: m(amount),
          status: "successful",
          reference,
          tenderedAmount: input.tenderedAmount ? m(input.tenderedAmount) : null,
          verificationMethod: input.verificationMethod,
          verifiedBy: actor.id,
          verifiedAt: now,
          receivedAt: now,
          verificationNote: input.note ?? null,
          createdBy: actor.id,
        })
        .returning();
    }
    const totals = await recomputeSalePayments(tx, saleId);
    await audit(tx, auditActorOf(actor), {
      action: "payment.verified",
      entityType: "sale",
      entityId: saleId,
      summary: `Confirmed ${formatINR(row.amount)} ${PAYMENT_METHOD_LABEL[row.method] ?? row.method}${reference ? ` (ref ${reference})` : ""} on ${sale.saleNumber} — ${input.verificationMethod.replace(/_/g, " ")}`,
      data: {
        paymentId: row.id,
        amount: row.amount,
        method: row.method,
        reference,
        verificationMethod: input.verificationMethod,
        tendered: row.tenderedAmount,
        change: row.tenderedAmount ? m(D(row.tenderedAmount).minus(amount)) : null,
        paymentStatus: totals.status,
      },
    });
    return { payment: row, paymentStatus: totals.status, amountPaid: m(totals.paid) };
  });
}

export async function markPaymentFailed(actor: Actor, paymentId: string, status: "failed" | "cancelled" | "expired", reason: string) {
  requirePermission(actor, "payments.record");
  const db = getDb();
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) throw notFound("Payment");
    const sale = await lockSale(tx, p.saleId);
    if (!canSeeSale(actor, sale)) throw forbidden();
    if (p.status !== "initiated" && p.status !== "pending") throw conflict(`Payment is already ${p.status}`);
    await tx.update(payments).set({ status, failureReason: reason, updatedAt: new Date() }).where(eq(payments.id, paymentId));
    await audit(tx, auditActorOf(actor), {
      action: `payment.${status}`,
      entityType: "sale",
      entityId: p.saleId,
      summary: `Marked QR payment of ₹${p.amount} as ${status}`,
      data: { paymentId, reason },
    });
  });
}

/** Undo a confirmation that was made in error (money was NOT actually received). */
export async function reversePayment(actor: Actor, paymentId: string, reason: string) {
  requirePermission(actor, "payments.reverse");
  if (reason.trim().length < 5) throw invalid("Explain why this payment is being reversed");
  const db = getDb();
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
    if (!p) throw notFound("Payment");
    const sale = await lockSale(tx, p.saleId);
    if (p.status !== "successful") throw conflict("Only a confirmed payment can be reversed");
    if (p.direction === "in") {
      const after = D(sale.amountPaid).minus(D(p.amount));
      if (after.lessThan(D(sale.amountRefunded))) throw conflict("Refunds already exceed what would remain paid");
    }
    const now = new Date();
    await tx
      .update(payments)
      .set({ status: "reversed", reversedBy: actor.id, reversedAt: now, reversalReason: reason.trim(), updatedAt: now })
      .where(eq(payments.id, paymentId));
    const totals = await recomputeSalePayments(tx, p.saleId);
    await audit(tx, auditActorOf(actor), {
      action: "payment.reversed",
      entityType: "sale",
      entityId: p.saleId,
      summary: `Reversed ₹${p.amount} ${p.method} payment on ${sale.saleNumber}: ${reason.trim()}`,
      data: { paymentId, reason, paymentStatus: totals.status },
    });
    return totals;
  });
}

/** Record money paid back to the customer (after a cancellation or credit note). */
export async function recordRefund(
  tx: Tx,
  actor: Actor,
  saleId: string,
  input: { amount: string; method: Method; reference?: string | null; note?: string | null; creditNoteDocumentId?: string | null },
) {
  requirePermission(actor, "payments.refund");
  const sale = await lockSale(tx, saleId);
  const amount = D(input.amount);
  const refundable = D(sale.amountPaid).minus(D(sale.amountRefunded));
  if (amount.lessThanOrEqualTo(0)) throw invalid("Refund amount must be positive");
  if (amount.greaterThan(refundable)) throw invalid(`Refund cannot exceed the ₹${m(refundable)} received`);
  if (input.method !== "cash" && !input.reference?.trim()) throw invalid("Enter the refund transaction reference");
  const now = new Date();
  const [row] = await tx
    .insert(payments)
    .values({
      saleId,
      direction: "refund",
      method: input.method,
      provider: "manual",
      amount: m(amount),
      status: "successful",
      reference: input.reference?.trim() || null,
      verificationMethod: input.method === "cash" ? "cash_counted" : "manual_bank_statement",
      verifiedBy: actor.id,
      verifiedAt: now,
      receivedAt: now,
      verificationNote: input.note ?? null,
      creditNoteDocumentId: input.creditNoteDocumentId ?? null,
      createdBy: actor.id,
    })
    .returning();
  const totals = await recomputeSalePayments(tx, saleId);
  await audit(tx, auditActorOf(actor), {
    action: "payment.refund",
    entityType: "sale",
    entityId: saleId,
    summary: `Refunded ₹${row.amount} by ${row.method} on ${sale.saleNumber}`,
    data: { paymentId: row.id, reference: row.reference, creditNoteDocumentId: input.creditNoteDocumentId ?? null, note: input.note ?? null },
  });
  return { payment: row, ...totals };
}

/* ------------------------------------------------------------------ */
/* Gateway webhooks (idempotent)                                       */
/* ------------------------------------------------------------------ */

export type WebhookOutcome =
  | "processed"
  | "duplicate"
  | "invalid_signature"
  | "ignored"
  | "unknown_payment"
  | "amount_mismatch"
  | "already_settled";

export async function handleGatewayWebhook(
  provider: string,
  rawBody: string,
  headers: Headers,
): Promise<{ outcome: WebhookOutcome; status: number }> {
  if (provider !== "razorpay") return { outcome: "ignored", status: 404 };
  const cfg = razorpayConfigFromEnv();
  if (!cfg) return { outcome: "ignored", status: 404 };
  const signatureValid = verifyRazorpaySignature(rawBody, headers.get("x-razorpay-signature"), cfg.webhookSecret);
  if (!signatureValid) {
    // Do not store unauthenticated payloads; just audit the attempt.
    await getDb().transaction((tx) =>
      audit(tx, { userId: null, label: `webhook:${provider}` }, { action: "payment.webhook_rejected", summary: "Rejected webhook with invalid signature" }),
    );
    return { outcome: "invalid_signature", status: 401 };
  }
  let event: NormalizedPaymentEvent;
  try {
    event = parseRazorpayEvent(rawBody, headers.get("x-razorpay-event-id"));
  } catch {
    return { outcome: "ignored", status: 400 };
  }
  // Website orders (Razorpay checkout): order.paid, payment.*, refund.* about one of those orders just make the
  // server ask Razorpay. Anything else (the counter's QR payments) carries on below.
  const parsed = JSON.parse(rawBody) as Record<string, unknown>;
  if ((await handleRazorpayOrderEvent(rawBody, parsed)).matched) return { outcome: "processed", status: 200 };
  return processPaymentEvent(provider, event, parsed);
}

export async function processPaymentEvent(provider: string, event: NormalizedPaymentEvent, payload: unknown) {
  const db = getDb();
  return db.transaction(async (tx): Promise<{ outcome: WebhookOutcome; status: number }> => {
    const inserted = await tx
      .insert(paymentEvents)
      .values({ provider, eventId: event.eventId, eventType: event.eventType, signatureValid: true, payload: payload as object })
      .onConflictDoNothing()
      .returning({ id: paymentEvents.id });
    if (!inserted.length) return { outcome: "duplicate", status: 200 };
    const eventRowId = inserted[0].id;
    const finish = async (outcome: WebhookOutcome, paymentId?: string) => {
      await tx.update(paymentEvents).set({ processedAt: new Date(), result: outcome, paymentId: paymentId ?? null }).where(eq(paymentEvents.id, eventRowId));
      return { outcome, status: 200 };
    };

    if (event.eventType !== "qr_code.credited" || event.status !== "captured") return finish("ignored");
    if (!event.providerOrderId) return finish("unknown_payment");
    const [p] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerOrderId, event.providerOrderId)))
      .for("update");
    if (!p) return finish("unknown_payment");
    if (p.status === "successful") return finish("already_settled", p.id);
    if (event.providerPaymentId) {
      const dup = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, event.providerPaymentId)));
      if (dup.length) return finish("already_settled", dup[0].id);
    }
    if (event.currency !== "INR" || !event.amount || !D(event.amount).equals(D(p.amount))) {
      await audit(tx, { userId: null, label: `webhook:${provider}` }, {
        action: "payment.webhook_amount_mismatch",
        entityType: "sale",
        entityId: p.saleId,
        summary: `Gateway reported ₹${event.amount ?? "?"} ${event.currency ?? ""} for a ₹${p.amount} QR — needs manual review`,
        data: { paymentId: p.id, event },
      });
      return finish("amount_mismatch", p.id);
    }
    if (p.status !== "initiated" && p.status !== "pending") {
      // QR was cancelled/expired locally but the customer paid anyway: flag for staff.
      await audit(tx, { userId: null, label: `webhook:${provider}` }, {
        action: "payment.webhook_after_close",
        entityType: "sale",
        entityId: p.saleId,
        summary: `Gateway payment ₹${event.amount} received on a ${p.status} QR — record it manually after checking`,
        data: { paymentId: p.id, event },
      });
      return finish("already_settled", p.id);
    }
    const sale = await lockSale(tx, p.saleId);
    const now = new Date();
    await tx
      .update(payments)
      .set({
        status: "successful",
        providerPaymentId: event.providerPaymentId,
        reference: event.reference,
        verificationMethod: "gateway_webhook",
        verifiedAt: now,
        receivedAt: now,
        providerData: { ...((p.providerData as object) ?? {}), webhookEventId: event.eventId },
        updatedAt: now,
      })
      .where(eq(payments.id, p.id));
    const totals = await recomputeSalePayments(tx, p.saleId);
    await audit(tx, { ...SYSTEM_ACTOR, label: `webhook:${provider}` }, {
      action: "payment.verified",
      entityType: "sale",
      entityId: p.saleId,
      summary: `Gateway confirmed ₹${p.amount} UPI on ${sale.saleNumber} (ref ${event.reference ?? event.providerPaymentId})`,
      data: { paymentId: p.id, event, paymentStatus: totals.status },
    });
    return finish("processed", p.id);
  });
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export async function getPayment(actor: Actor, paymentId: string) {
  const db = getDb();
  const [p] = await db.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) throw notFound("Payment");
  const [sale] = await db.select().from(sales).where(eq(sales.id, p.saleId));
  if (!canSeeSale(actor, sale)) throw forbidden();
  return { payment: p, sale: { id: sale.id, saleNumber: sale.saleNumber, grandTotal: sale.grandTotal, amountPaid: sale.amountPaid, paymentStatus: sale.paymentStatus, status: sale.status } };
}

export interface PaymentFilter {
  q?: string;
  status?: string;
  method?: string;
  direction?: "in" | "refund";
  from?: Date;
  to?: Date;
  includeTraining?: boolean;
  page?: number;
  pageSize?: number;
}

export async function listPayments(actor: Actor, f: PaymentFilter) {
  requirePermission(actor, "payments.view");
  const db = getDb();
  const verifier = alias(users, "verifier");
  const where: SQL[] = [];
  if (!can(actor, "sales.view_all")) where.push(eq(sales.createdBy, actor.id));
  if (f.status) where.push(eq(payments.status, f.status as Payment["status"]));
  if (f.method) where.push(eq(payments.method, f.method as Method));
  if (f.direction) where.push(eq(payments.direction, f.direction));
  if (f.from) where.push(gte(payments.createdAt, f.from));
  if (f.to) where.push(lte(payments.createdAt, f.to));
  if (!f.includeTraining) where.push(eq(sales.isTraining, false));
  where.push(isNull(sales.deletedAt));
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    where.push(or(ilike(payments.reference, like), ilike(sales.saleNumber, like), ilike(customers.name, like), ilike(customers.mobile, like))!);
  }
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const page = Math.max(1, f.page ?? 1);
  const rows = await db
    .select({
      p: payments,
      saleNumber: sales.saleNumber,
      saleId: sales.id,
      isTraining: sales.isTraining,
      customerName: customers.name,
      verifiedByName: verifier.displayName,
      total: sql<number>`count(*) over ()::int`,
    })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(verifier, eq(verifier.id, payments.verifiedBy))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return {
    total: rows[0]?.total ?? 0,
    page,
    pageSize,
    items: rows.map((r) => ({
      ...r.p,
      qrPayload: undefined,
      providerData: undefined,
      saleNumber: r.saleNumber,
      isTraining: r.isTraining,
      customerName: r.customerName,
      verifiedByName: r.verifiedByName,
    })),
  };
}

export async function pendingPayments(actor: Actor) {
  requirePermission(actor, ["payments.view", "payments.record"]);
  const db = getDb();
  const where: SQL[] = [inArray(sales.status, ["finalized", "completed"]), sql`${sales.amountPaid} < ${sales.grandTotal}`, eq(sales.isTraining, false), isNull(sales.deletedAt)];
  if (!can(actor, "sales.view_all")) where.push(eq(sales.createdBy, actor.id));
  return db
    .select({ id: sales.id, saleNumber: sales.saleNumber, status: sales.status, grandTotal: sales.grandTotal, amountPaid: sales.amountPaid, finalizedAt: sales.finalizedAt, customerName: customers.name })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(...where))
    .orderBy(desc(sales.finalizedAt))
    .limit(200);
}
