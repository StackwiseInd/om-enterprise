import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { coupons, onlineOrders, paymentEvents } from "@/server/db/schema";
import { audit, type AuditActor } from "@/server/audit";
import { auditActorOf, requirePermission, type Actor } from "@/server/auth/actor";
import { conflict, invalid, notFound, precondition } from "@/server/errors";
import { releaseCoupon } from "@/server/services/coupons";
import { PhonePeClient, phonePeConfigFromEnv, toPaise, verifyPhonePeWebhookAuth, type PhonePeOrderStatus } from "@/server/payments/phonepe";
import { formatPrice } from "@/lib/money";

/**
 * Online-order payments through PhonePe Payment Gateway. An order is marked paid only when PhonePe's
 * Order Status API (called by this server with its own token) says COMPLETED for exactly the order
 * total. Browser redirects and webhooks are only cues to ask. Pending payments are re-checked on
 * PhonePe's required schedule; money that arrives for an order that was meanwhile cancelled or
 * expired is refunded automatically.
 */

type Order = typeof onlineOrders.$inferSelect;

const PHONEPE: AuditActor = { userId: null, label: "PhonePe" };
/** How long PhonePe's checkout page stays open for one attempt. */
export const GATEWAY_PAY_SECONDS = 30 * 60;
const MAX_ATTEMPTS = 5;

export function gatewayEnabled() {
  return phonePeConfigFromEnv() !== null;
}

let clientOverride: PhonePeClient | null = null;
/** Tests only: talk to a stand-in PhonePe. */
export function __setPhonePeClientForTests(c: PhonePeClient | null) {
  clientOverride = c;
}

function client(): PhonePeClient {
  if (clientOverride) return clientOverride;
  const cfg = phonePeConfigFromEnv();
  if (!cfg) throw precondition("Online payment isn't set up yet. Please send your cart as an order request instead.");
  return new PhonePeClient(cfg);
}

function baseUrl() {
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

const friendlyFailure = (s: PhonePeOrderStatus) =>
  s.errorDescription ||
  (s.errorCode === "INVALID_MPIN" ? "Wrong UPI PIN was entered." : s.errorCode ? `The payment didn't go through (${s.errorCode}).` : "The payment didn't go through, or the time to pay ran out.");

/* ------------------------------------------------------------------ */
/* Starting a payment                                                  */
/* ------------------------------------------------------------------ */

/**
 * Open a PhonePe checkout for the order's current attempt (already recorded in the row) and keep its
 * page URL. If PhonePe can't be reached, the attempt is marked failed and its code freed.
 */
export async function openGatewayCheckout(orderId: string): Promise<string> {
  const db = getDb();
  const [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, orderId));
  if (!o || !o.gatewayMerchantOrderId) throw notFound("Order");
  try {
    const r = await client().createCheckout({
      merchantOrderId: o.gatewayMerchantOrderId,
      amountPaise: toPaise(o.total),
      expireAfterSeconds: GATEWAY_PAY_SECONDS,
      redirectUrl: `${baseUrl()}/my-orders/${o.orderNumber}?from=phonepe`,
      mobile: o.mobile,
      note: `OM ENTERPRISE order ${o.orderNumber}`,
    });
    const expires = r.expireAt ?? new Date(Date.now() + GATEWAY_PAY_SECONDS * 1000);
    await db.transaction(async (tx) => {
      await tx
        .update(onlineOrders)
        .set({ gatewayOrderId: r.orderId, gatewayRedirectUrl: r.redirectUrl, gatewayExpiresAt: expires, gatewayState: r.state, expiresAt: new Date(expires.getTime() + 15 * 60_000), updatedAt: new Date() })
        .where(eq(onlineOrders.id, o.id));
      await audit(tx, PHONEPE, {
        action: "online_order.gateway_started",
        entityType: "online_order",
        entityId: o.id,
        summary: `PhonePe checkout opened for ${o.orderNumber} (${o.gatewayMerchantOrderId}, PhonePe order ${r.orderId ?? "?"}): ${formatPrice(o.total)}`,
      });
    });
    return r.redirectUrl;
  } catch (err) {
    console.error("[phonepe] create checkout failed", err);
    await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, o.id)).for("update");
      if (cur?.status !== "awaiting_payment") return;
      await tx.update(onlineOrders).set({ status: "payment_failed", failureReason: "We couldn't open the payment page. Please try again.", gatewayState: "NOT_STARTED", updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
      await releaseCoupon(tx, o.couponId);
      await audit(tx, PHONEPE, { action: "online_order.gateway_start_failed", entityType: "online_order", entityId: o.id, summary: `Couldn't open PhonePe checkout for ${o.orderNumber}: ${(err as Error).message}` });
    });
    throw precondition("PhonePe isn't responding right now. Please try again in a minute.");
  }
}

/** A new attempt after a failed one: fresh merchantOrderId, code reserved again if still free. */
export async function retryGatewayPayment(accountId: string, orderNumber: string, actor: AuditActor): Promise<string> {
  const db = getDb();
  const id = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(and(eq(onlineOrders.orderNumber, orderNumber), eq(onlineOrders.accountId, accountId))).for("update");
    if (!o) throw notFound("Order");
    if (o.paymentMethod !== "phonepe") throw conflict("This order is paid by UPI QR.");
    if (o.status !== "payment_failed") throw conflict("This order isn't waiting for a new payment attempt.");
    if (o.gatewayAttempt >= MAX_ATTEMPTS) throw precondition("Too many attempts on this order. Please add the items to your cart and place a new order.");
    if (o.couponId) {
      const taken = await tx.update(coupons).set({ status: "reserved", orderId: o.id }).where(and(eq(coupons.id, o.couponId), eq(coupons.status, "active"))).returning({ id: coupons.id });
      if (!taken.length) throw precondition("Your discount code is no longer available. Please place a new order.");
    }
    const attempt = o.gatewayAttempt + 1;
    await tx
      .update(onlineOrders)
      .set({
        status: "awaiting_payment",
        gatewayAttempt: attempt,
        gatewayMerchantOrderId: `${o.orderNumber}-${attempt}`,
        gatewayOrderId: null,
        gatewayRedirectUrl: null,
        gatewayState: null,
        gatewayCheckedAt: null,
        failureReason: null,
        updatedAt: new Date(),
      })
      .where(eq(onlineOrders.id, o.id));
    await audit(tx, actor, { action: "online_order.gateway_retry", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber}: payment attempt ${attempt} started` });
    return o.id;
  });
  return openGatewayCheckout(id);
}

/* ------------------------------------------------------------------ */
/* Reconciling with PhonePe                                            */
/* ------------------------------------------------------------------ */

/**
 * PhonePe's required status-check schedule for a pending payment: first at 20–25 s, then every 3 s
 * (next 30 s), 6 s (60 s), 10 s (60 s), 30 s (60 s), then every minute.
 */
export function checkIntervalMs(ageMs: number): number {
  if (ageMs < 20_000) return Infinity;
  if (ageMs < 50_000) return 3_000;
  if (ageMs < 110_000) return 6_000;
  if (ageMs < 170_000) return 10_000;
  if (ageMs < 230_000) return 30_000;
  return 60_000;
}

function due(o: Order, now = Date.now()) {
  const started = o.gatewayExpiresAt ? o.gatewayExpiresAt.getTime() - GATEWAY_PAY_SECONDS * 1000 : o.createdAt.getTime();
  const last = o.gatewayCheckedAt?.getTime() ?? 0;
  return now - last >= checkIntervalMs(now - started);
}

/** Ask PhonePe about this order (if due, or always with `force`) and apply the answer. */
export async function reconcileOrder(orderId: string, opts: { force?: boolean } = {}) {
  const db = getDb();
  const [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, orderId));
  if (!o || o.paymentMethod !== "phonepe" || !o.gatewayMerchantOrderId) return;
  if (o.status === "refunding") return reconcileRefund(o.id);
  const watch = o.status === "awaiting_payment" || (["cancelled", "expired", "payment_failed"].includes(o.status) && o.gatewayState === "PENDING");
  if (!watch) return;
  if (!opts.force && !due(o)) return;
  let s: PhonePeOrderStatus;
  try {
    s = await client().orderStatus(o.gatewayMerchantOrderId);
  } catch (err) {
    console.error("[phonepe] status check failed", o.orderNumber, err);
    await db.update(onlineOrders).set({ gatewayCheckedAt: new Date() }).where(eq(onlineOrders.id, o.id));
    return;
  }
  await applyStatus(o.id, o.gatewayMerchantOrderId, s);
}

async function applyStatus(orderId: string, merchantOrderId: string, s: PhonePeOrderStatus) {
  let refundAfter = false;
  await getDb().transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, orderId)).for("update");
    // Only the attempt we asked about counts; a newer attempt may have started meanwhile.
    if (!o || o.gatewayMerchantOrderId !== merchantOrderId) return;
    const now = new Date();
    const base = { gatewayState: s.state, gatewayCheckedAt: now, gatewayOrderId: s.orderId ?? o.gatewayOrderId, updatedAt: now };

    if (s.state === "COMPLETED") {
      const expected = toPaise(o.total);
      const pay = { gatewayTransactionId: s.transactionId ?? s.orderId ?? merchantOrderId, gatewayPaymentMode: s.paymentMode, gatewayUtr: s.utr };
      if (s.amountPaise !== expected) {
        await tx.update(onlineOrders).set({ ...base, ...pay, status: o.status === "awaiting_payment" ? "payment_submitted" : o.status, verificationNote: `PhonePe reports ₹${(s.amountPaise ?? 0) / 100}, order total ${formatPrice(o.total)}` }).where(eq(onlineOrders.id, o.id));
        await audit(tx, PHONEPE, { action: "online_order.gateway_amount_mismatch", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber}: PhonePe says COMPLETED for ${s.amountPaise} paise but the order is ${expected} paise. Check by hand.` });
        return;
      }
      if (o.status === "awaiting_payment") {
        await tx.update(onlineOrders).set({ ...base, ...pay, status: "paid", verifiedAt: now, verificationNote: `PhonePe ${s.paymentMode ?? "payment"} confirmed by the Order Status API`, failureReason: null }).where(eq(onlineOrders.id, o.id));
        if (o.couponId) await tx.update(coupons).set({ status: "used", usedAt: now }).where(eq(coupons.id, o.couponId));
        await audit(tx, PHONEPE, {
          action: "online_order.payment_verified",
          entityType: "online_order",
          entityId: o.id,
          summary: `Payment for ${o.orderNumber} confirmed by PhonePe: ${formatPrice(o.total)} via ${s.paymentMode ?? "?"}, transaction ${pay.gatewayTransactionId}${s.utr ? `, UTR ${s.utr}` : ""}${o.couponCode ? `; code ${o.couponCode} used` : ""}`,
        });
      } else if (["cancelled", "expired", "payment_failed"].includes(o.status)) {
        // Paid after the order was closed: give the money back.
        await tx.update(onlineOrders).set({ ...base, ...pay, status: "refunding", refundReason: "Paid after the order was closed", updatedAt: now }).where(eq(onlineOrders.id, o.id));
        await audit(tx, PHONEPE, { action: "online_order.late_payment", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber} was paid (${formatPrice(o.total)}) after it was ${o.status}; refunding automatically` });
        refundAfter = true;
      }
      return;
    }

    if (s.state === "FAILED") {
      if (o.status === "awaiting_payment") {
        await tx.update(onlineOrders).set({ ...base, status: "payment_failed", failureReason: friendlyFailure(s) }).where(eq(onlineOrders.id, o.id));
        await releaseCoupon(tx, o.couponId);
        await audit(tx, PHONEPE, { action: "online_order.payment_failed", entityType: "online_order", entityId: o.id, summary: `PhonePe payment for ${o.orderNumber} failed: ${s.errorCode ?? "no code"}${s.errorDescription ? ` (${s.errorDescription})` : ""}` });
      } else {
        await tx.update(onlineOrders).set(base).where(eq(onlineOrders.id, o.id));
      }
      return;
    }

    await tx.update(onlineOrders).set(base).where(eq(onlineOrders.id, o.id));
  });
  if (refundAfter) await startRefund(orderId, PHONEPE).catch((err) => console.error("[phonepe] automatic refund failed to start", err));
}

/** Reconcile every PhonePe order still waiting on an answer (called from staff pages and the cron). */
export async function reconcileOpenOrders(limit = 25) {
  if (!gatewayEnabled() && !clientOverride) return;
  const db = getDb();
  const rows = await db
    .select({ id: onlineOrders.id })
    .from(onlineOrders)
    .where(
      and(
        eq(onlineOrders.paymentMethod, "phonepe"),
        isNotNull(onlineOrders.gatewayMerchantOrderId),
        or(
          eq(onlineOrders.status, "awaiting_payment"),
          eq(onlineOrders.status, "refunding"),
          and(inArray(onlineOrders.status, ["cancelled", "expired", "payment_failed"]), eq(onlineOrders.gatewayState, "PENDING"), gt(onlineOrders.createdAt, sql`now() - interval '2 days'`)),
        ),
      ),
    )
    .limit(limit);
  for (const r of rows) await reconcileOrder(r.id);
}

/* ------------------------------------------------------------------ */
/* Refunds                                                             */
/* ------------------------------------------------------------------ */

/** No refund yet, the last one failed, or a start was interrupted more than 2 minutes ago. */
function canStartRefund(o: Order) {
  if (!o.refundState || o.refundState === "FAILED") return true;
  return o.refundState === "STARTING" && Date.now() - o.updatedAt.getTime() > 2 * 60_000;
}

/** Begin (or retry) a full refund of a PhonePe-paid order that is in "refunding". */
async function startRefund(orderId: string, actor: AuditActor) {
  const db = getDb();
  const prepared = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, orderId)).for("update");
    if (!o || o.status !== "refunding" || !o.gatewayMerchantOrderId) return null;
    if (!canStartRefund(o)) return null; // one refund at a time
    const n = o.refundAttempt + 1;
    const merchantRefundId = `${o.orderNumber}-R${n}`;
    await tx.update(onlineOrders).set({ refundAttempt: n, refundMerchantId: merchantRefundId, refundState: "STARTING", refundAmount: o.total, updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
    return { o, merchantRefundId };
  });
  if (!prepared) return;
  const { o, merchantRefundId } = prepared;
  try {
    const r = await client().refund({ merchantRefundId, originalMerchantOrderId: o.gatewayMerchantOrderId!, amountPaise: toPaise(o.total) });
    await db.transaction(async (tx) => {
      await tx.update(onlineOrders).set({ refundGatewayId: r.refundId, refundState: r.state, updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
      await audit(tx, actor, { action: "online_order.refund_started", entityType: "online_order", entityId: o.id, summary: `Refund ${merchantRefundId} of ${formatPrice(o.total)} sent to PhonePe for ${o.orderNumber} (${r.state})` });
    });
  } catch (err) {
    await db.transaction(async (tx) => {
      await tx.update(onlineOrders).set({ refundState: "FAILED", updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
      await audit(tx, actor, { action: "online_order.refund_failed", entityType: "online_order", entityId: o.id, summary: `Refund ${merchantRefundId} for ${o.orderNumber} could not be started: ${(err as Error).message}` });
    });
    throw err;
  }
}

export async function reconcileRefund(orderId: string) {
  const db = getDb();
  const [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, orderId));
  if (!o || o.status !== "refunding") return;
  if (!o.refundMerchantId || o.refundState === "FAILED" || o.refundState === "STARTING") return;
  let r: Awaited<ReturnType<PhonePeClient["refundStatus"]>>;
  try {
    r = await client().refundStatus(o.refundMerchantId);
  } catch (err) {
    console.error("[phonepe] refund status failed", o.orderNumber, err);
    return;
  }
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, orderId)).for("update");
    if (!cur || cur.status !== "refunding" || cur.refundMerchantId !== o.refundMerchantId) return;
    if (r.state === "COMPLETED") {
      await tx.update(onlineOrders).set({ status: "refunded", refundState: "COMPLETED", refundedAt: new Date(), updatedAt: new Date() }).where(eq(onlineOrders.id, cur.id));
      // The sale didn't happen, so a code it used can be given out again.
      if (cur.couponId) await tx.update(coupons).set({ status: "active", orderId: null, usedAt: null }).where(and(eq(coupons.id, cur.couponId), eq(coupons.orderId, cur.id)));
      await audit(tx, PHONEPE, { action: "online_order.refunded", entityType: "online_order", entityId: cur.id, summary: `Refund ${cur.refundMerchantId} of ${formatPrice(cur.total)} for ${cur.orderNumber} completed` });
    } else if (r.state === "FAILED") {
      await tx.update(onlineOrders).set({ refundState: "FAILED", updatedAt: new Date() }).where(eq(onlineOrders.id, cur.id));
      await audit(tx, PHONEPE, { action: "online_order.refund_failed", entityType: "online_order", entityId: cur.id, summary: `Refund ${cur.refundMerchantId} for ${cur.orderNumber} failed at PhonePe; retry it from the order page` });
    } else if (r.state !== cur.refundState) {
      await tx.update(onlineOrders).set({ refundState: r.state, updatedAt: new Date() }).where(eq(onlineOrders.id, cur.id));
    }
  });
}

/** Staff: cancel a PhonePe-paid order and refund it in full, or retry a refund that failed. */
export async function refundOnlineOrder(actor: Actor, id: string, input: { reason: string }) {
  requirePermission(actor, "payments.refund");
  const reason = input.reason.trim();
  const db = getDb();
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, id)).for("update");
    if (!o) throw notFound("Online order");
    if (o.paymentMethod !== "phonepe") throw conflict("This order was paid by UPI QR; refund it at the counter.");
    if (o.status === "refunding") {
      if (!canStartRefund(o)) throw conflict("A refund for this order is already in progress.");
      await audit(tx, auditActorOf(actor), { action: "online_order.refund_retry", entityType: "online_order", entityId: o.id, summary: `Refund for ${o.orderNumber} retried` });
      return;
    }
    if (!["paid", "ready"].includes(o.status)) throw conflict("Only a paid order that hasn't been collected can be refunded here.");
    if (reason.length < 3) throw invalid("Say why the order is refunded");
    await tx.update(onlineOrders).set({ status: "refunding", refundReason: reason.slice(0, 300), cancelledAt: new Date(), cancelReason: reason.slice(0, 300), handledBy: actor.id, updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
    await audit(tx, auditActorOf(actor), { action: "online_order.refund_requested", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber} cancelled and refunded (${formatPrice(o.total)}): ${reason}` });
  });
  await startRefund(id, auditActorOf(actor));
}

/** Staff: ask PhonePe now instead of waiting for the schedule. */
export async function checkGatewayNow(actor: Actor, id: string) {
  requirePermission(actor, ["orders.view", "payments.verify"]);
  await reconcileOrder(id, { force: true });
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

/**
 * PhonePe's server-to-server callback. Logged once per distinct body; then, whether or not its
 * Authorization header checks out, the order (or refund) is re-checked with the Status API, which is
 * the only thing that changes an order. A forged callback can't mark anything paid.
 */
export async function handlePhonePeWebhook(rawBody: string, authHeader: string | null) {
  const cfg = phonePeConfigFromEnv();
  const valid = cfg ? verifyPhonePeWebhookAuth(authHeader, cfg) : false;
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "not JSON" };
  }
  const event = typeof body.event === "string" ? body.event : "unknown";
  const payload = body.payload && typeof body.payload === "object" ? (body.payload as Record<string, unknown>) : {};
  const merchantOrderId = typeof payload.merchantOrderId === "string" ? payload.merchantOrderId : typeof payload.originalMerchantOrderId === "string" ? payload.originalMerchantOrderId : null;
  const merchantRefundId = typeof payload.merchantRefundId === "string" ? payload.merchantRefundId : null;

  const db = getDb();
  const [o] = merchantOrderId
    ? await db.select({ id: onlineOrders.id }).from(onlineOrders).where(eq(onlineOrders.gatewayMerchantOrderId, merchantOrderId))
    : merchantRefundId
      ? await db.select({ id: onlineOrders.id }).from(onlineOrders).where(eq(onlineOrders.refundMerchantId, merchantRefundId))
      : [];
  await db
    .insert(paymentEvents)
    .values({
      provider: "phonepe",
      eventId: createHash("sha256").update(rawBody).digest("hex"),
      eventType: event,
      signatureValid: valid,
      payload: body,
      processedAt: new Date(),
      result: o ? (valid ? "re-checked with the Status API" : "unverified: re-checked with the Status API") : "no matching order",
    })
    .onConflictDoNothing();
  if (!o) return { ok: true, matched: false };
  if (event.startsWith("pg.refund")) await reconcileRefund(o.id);
  else await reconcileOrder(o.id, { force: true });
  return { ok: true, matched: true, verified: valid };
}

