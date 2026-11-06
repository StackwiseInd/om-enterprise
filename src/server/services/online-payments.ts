import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { coupons, onlineOrders, paymentEvents } from "@/server/db/schema";
import { audit, type AuditActor } from "@/server/audit";
import { auditActorOf, requirePermission, type Actor } from "@/server/auth/actor";
import { badRequest, conflict, invalid, notFound, precondition } from "@/server/errors";
import { enforceRateLimit } from "@/server/rate-limit";
import { releaseCoupon } from "@/server/services/coupons";
import { getSettings } from "@/server/settings";
import { RazorpayClient, razorpayConfigFromEnv, toPaise, verifyCheckoutSignature, type GatewayOrderStatus } from "@/server/payments/razorpay";
import { GATEWAY_NAME } from "@/lib/gateway";
import { formatPrice } from "@/lib/money";

/**
 * Online-order payments through Razorpay Standard Web Checkout.
 *
 * - Placing an order creates ONE Razorpay order; the customer pays it in Razorpay's checkout modal (a failed
 *   or abandoned try is simply tried again in the same modal; a "Try again" after our time limit reuses it).
 * - checkout.js returns a signature; this server verifies it, but an order is marked paid only when Razorpay's
 *   own API (called with this server's secret) says the order is paid, its payment captured, for exactly the
 *   order total. Browser results and webhooks are only cues to ask.
 * - Pending payments are re-checked on a schedule; money that arrives for an order that was meanwhile
 *   cancelled or timed out is refunded automatically.
 */

type Order = typeof onlineOrders.$inferSelect;

const RAZORPAY: AuditActor = { userId: null, label: GATEWAY_NAME };
/** How long one try at paying is offered. The order page also allows 15 more minutes for a payment already under way. */
export const GATEWAY_PAY_SECONDS = 30 * 60;
const GRACE_MS = 15 * 60_000;
const MAX_ATTEMPTS = 5;

let clientOverride: RazorpayClient | null = null;
/** Tests only: talk to a stand-in Razorpay. */
export function __setRazorpayClientForTests(c: RazorpayClient | null) {
  clientOverride = c;
}

/** Is Razorpay set up (both keys present)? */
export function gatewayEnabled() {
  return clientOverride !== null || razorpayConfigFromEnv() !== null;
}

function client(): RazorpayClient {
  if (clientOverride) return clientOverride;
  const cfg = razorpayConfigFromEnv();
  if (!cfg) throw precondition("Online payment isn't set up yet. Please send your cart as an order request instead.");
  return new RazorpayClient(cfg);
}

/** What checkout.js needs to open the payment modal. The key id is public; the secret never leaves the server. */
export interface CheckoutParams {
  keyId: string;
  orderId: string;
  /** Paise. */
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  prefill: { name: string; contact: string };
  /** Seconds the modal stays open. */
  timeoutSeconds: number;
}

async function checkoutParams(o: Order): Promise<CheckoutParams> {
  if (!o.gatewayOrderId) throw precondition("This order has no payment page yet. Please try again.");
  const business = await getSettings("business").catch(() => null);
  const left = o.gatewayExpiresAt ? Math.floor((o.gatewayExpiresAt.getTime() - Date.now()) / 1000) : GATEWAY_PAY_SECONDS;
  return {
    keyId: client().keyId,
    orderId: o.gatewayOrderId,
    amount: toPaise(o.total),
    currency: "INR",
    name: business?.name ?? "OM ENTERPRISE",
    description: `Order ${o.orderNumber}`,
    prefill: { name: o.customerName, contact: o.mobile },
    timeoutSeconds: Math.min(GATEWAY_PAY_SECONDS, Math.max(60, left)),
  };
}

/** Why an order is marked failed when its time to pay runs out. */
export const GATEWAY_TIMEOUT_REASON = "The time to pay ran out. You can try again.";

/* ------------------------------------------------------------------ */
/* Starting a payment                                                  */
/* ------------------------------------------------------------------ */

/**
 * Make sure the order's Razorpay order exists (created once, reused for every try), and return what the
 * checkout modal needs. If Razorpay can't be reached, the attempt is marked failed and its code freed.
 */
export async function openGatewayCheckout(orderId: string): Promise<CheckoutParams> {
  const db = getDb();
  let [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, orderId));
  if (!o || !o.gatewayMerchantOrderId) throw notFound("Order");
  if (!o.gatewayOrderId) {
    try {
      const r = await client().createOrder({ receipt: o.gatewayMerchantOrderId, amountPaise: toPaise(o.total), note: `OM ENTERPRISE order ${o.orderNumber}` });
      const expires = new Date(Date.now() + GATEWAY_PAY_SECONDS * 1000);
      [o] = await db.transaction(async (tx) => {
        const rows = await tx
          .update(onlineOrders)
          .set({ gatewayOrderId: r.orderId, gatewayState: "PENDING", gatewayExpiresAt: expires, expiresAt: new Date(expires.getTime() + GRACE_MS), updatedAt: new Date() })
          .where(eq(onlineOrders.id, o!.id))
          .returning();
        await audit(tx, RAZORPAY, {
          action: "online_order.gateway_started",
          entityType: "online_order",
          entityId: o!.id,
          summary: `${GATEWAY_NAME} order opened for ${o!.orderNumber} (${o!.gatewayMerchantOrderId}, ${GATEWAY_NAME} id ${r.orderId}): ${formatPrice(o!.total)}`,
        });
        return rows;
      });
    } catch (err) {
      console.error("[razorpay] create order failed", err);
      const failed = o;
      await db.transaction(async (tx) => {
        const [cur] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, failed.id)).for("update");
        if (cur?.status !== "awaiting_payment") return;
        await tx.update(onlineOrders).set({ status: "payment_failed", failureReason: "We couldn't open the payment page. Please try again.", gatewayState: "NOT_STARTED", updatedAt: new Date() }).where(eq(onlineOrders.id, failed.id));
        await releaseCoupon(tx, failed.couponId);
        await audit(tx, RAZORPAY, { action: "online_order.gateway_start_failed", entityType: "online_order", entityId: failed.id, summary: `Couldn't open a ${GATEWAY_NAME} order for ${failed.orderNumber}: ${(err as Error).message}` });
      });
      throw precondition(`${GATEWAY_NAME} isn't responding right now. Please try again in a minute.`);
    }
  }
  return checkoutParams(o);
}

/** Another try after a failed or timed-out one: the same Razorpay order, a fresh time limit, the code reserved again if still free. */
export async function retryGatewayPayment(accountId: string, orderNumber: string, actor: AuditActor): Promise<CheckoutParams> {
  const db = getDb();
  const id = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(and(eq(onlineOrders.orderNumber, orderNumber), eq(onlineOrders.accountId, accountId))).for("update");
    if (!o) throw notFound("Order");
    if (o.paymentMethod !== "razorpay") throw conflict("This order is paid by UPI QR.");
    if (o.status !== "payment_failed") throw conflict("This order isn't waiting for a new payment attempt.");
    if (o.gatewayAttempt >= MAX_ATTEMPTS) throw precondition("Too many attempts on this order. Please add the items to your cart and place a new order.");
    if (o.couponId) {
      const taken = await tx.update(coupons).set({ status: "reserved", orderId: o.id }).where(and(eq(coupons.id, o.couponId), eq(coupons.status, "active"))).returning({ id: coupons.id });
      if (!taken.length) throw precondition("Your discount code is no longer available. Please place a new order.");
    }
    const attempt = o.gatewayAttempt + 1;
    const expires = new Date(Date.now() + GATEWAY_PAY_SECONDS * 1000);
    await tx
      .update(onlineOrders)
      .set({ status: "awaiting_payment", gatewayAttempt: attempt, gatewayExpiresAt: expires, expiresAt: new Date(expires.getTime() + GRACE_MS), gatewayCheckedAt: null, failureReason: null, updatedAt: new Date() })
      .where(eq(onlineOrders.id, o.id));
    await audit(tx, actor, { action: "online_order.gateway_retry", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber}: payment attempt ${attempt} started` });
    return o.id;
  });
  return openGatewayCheckout(id);
}

/* ------------------------------------------------------------------ */
/* The customer's payment came back from the checkout modal            */
/* ------------------------------------------------------------------ */

/**
 * checkout.js returned razorpay_payment_id, razorpay_order_id and razorpay_signature. The signature is checked
 * here (a mismatch is a 400 and changes nothing); a good one only makes us ask Razorpay right now. The order is
 * paid only if Razorpay confirms it.
 */
export async function verifyCheckoutPayment(
  accountId: string,
  orderNumber: string,
  input: { orderId: string; paymentId: string; signature: string },
  actor: AuditActor,
): Promise<{ status: Order["status"] }> {
  const cfg = razorpayConfigFromEnv();
  if (!cfg && !clientOverride) throw precondition("Online payment isn't set up yet.");
  const secret = cfg?.keySecret ?? process.env.RAZORPAY_KEY_SECRET ?? "";
  const db = getDb();
  const [o] = await db.select().from(onlineOrders).where(and(eq(onlineOrders.orderNumber, orderNumber), eq(onlineOrders.accountId, accountId)));
  if (!o) throw notFound("Order");
  if (o.paymentMethod !== "razorpay" || !o.gatewayOrderId) throw conflict("This order isn't paid on Razorpay.");
  const ok = o.gatewayOrderId === input.orderId && verifyCheckoutSignature(input, secret);
  if (!ok) {
    await db.transaction((tx) =>
      audit(tx, actor, { action: "online_order.payment_signature_invalid", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber}: a payment result with a signature that doesn't match was sent; ignored` }),
    );
    throw badRequest("We couldn't verify this payment. If money was taken, it will show on this page shortly, or contact the shop with your order number.");
  }
  await reconcileOrder(o.id, { force: true });
  const [cur] = await db.select({ status: onlineOrders.status }).from(onlineOrders).where(eq(onlineOrders.id, o.id));
  return { status: cur?.status ?? o.status };
}

/* ------------------------------------------------------------------ */
/* Reconciling with Razorpay                                           */
/* ------------------------------------------------------------------ */

/**
 * How often a pending payment is re-checked: the first check after 20 s, then every 3 s (next 30 s), 6 s
 * (60 s), 10 s (60 s), 30 s (60 s), then every minute.
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

/** Ask Razorpay about this order (if due, or always with `force`) and apply the answer. */
export async function reconcileOrder(orderId: string, opts: { force?: boolean } = {}) {
  const db = getDb();
  const [o] = await db.select().from(onlineOrders).where(eq(onlineOrders.id, orderId));
  if (!o || o.paymentMethod !== "razorpay" || !o.gatewayMerchantOrderId || !o.gatewayOrderId) return;
  if (o.status === "refunding") return reconcileRefund(o.id);
  // Closed orders stay watched while Razorpay may still take a payment for them (so it can be refunded).
  const watch = o.status === "awaiting_payment" || (["cancelled", "expired", "payment_failed"].includes(o.status) && o.gatewayState === "PENDING");
  if (!watch) return;
  if (!opts.force && !due(o)) return;
  let s: GatewayOrderStatus;
  try {
    s = await client().orderStatus({ receipt: o.gatewayMerchantOrderId, gatewayOrderId: o.gatewayOrderId });
  } catch (err) {
    console.error("[razorpay] status check failed", o.orderNumber, err);
    await db.update(onlineOrders).set({ gatewayCheckedAt: new Date() }).where(eq(onlineOrders.id, o.id));
    return;
  }
  await applyStatus(o.id, o.gatewayOrderId, s);
}

async function applyStatus(orderId: string, gatewayOrderId: string, s: GatewayOrderStatus) {
  let refundAfter = false;
  await getDb().transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, orderId)).for("update");
    if (!o || o.gatewayOrderId !== gatewayOrderId) return;
    const now = new Date();
    const base = { gatewayCheckedAt: now, updatedAt: now };

    if (s.state !== "COMPLETED") {
      // Still waiting (created / attempted), or something we don't understand: just note that we asked.
      await tx.update(onlineOrders).set({ ...base, ...(s.state === "PENDING" ? { gatewayState: "PENDING" } : {}) }).where(eq(onlineOrders.id, o.id));
      return;
    }

    const expected = toPaise(o.total);
    const pay = { gatewayState: "COMPLETED", gatewayTransactionId: s.transactionId, gatewayPaymentMode: s.paymentMode, gatewayUtr: s.utr };
    if (s.amountPaise !== expected) {
      await tx
        .update(onlineOrders)
        .set({ ...base, ...pay, status: o.status === "awaiting_payment" ? "payment_submitted" : o.status, verificationNote: `${GATEWAY_NAME} reports ₹${(s.amountPaise ?? 0) / 100}, order total ${formatPrice(o.total)}` })
        .where(eq(onlineOrders.id, o.id));
      await audit(tx, RAZORPAY, { action: "online_order.gateway_amount_mismatch", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber}: ${GATEWAY_NAME} says paid for ${s.amountPaise} paise but the order is ${expected} paise. Check by hand.` });
      return;
    }
    if (o.status === "awaiting_payment") {
      await tx
        .update(onlineOrders)
        .set({ ...base, ...pay, status: "paid", verifiedAt: now, verificationNote: `${GATEWAY_NAME} payment confirmed by the ${GATEWAY_NAME} API`, failureReason: null })
        .where(eq(onlineOrders.id, o.id));
      if (o.couponId) await tx.update(coupons).set({ status: "used", usedAt: now }).where(eq(coupons.id, o.couponId));
      await audit(tx, RAZORPAY, {
        action: "online_order.payment_verified",
        entityType: "online_order",
        entityId: o.id,
        summary: `Payment for ${o.orderNumber} confirmed by ${GATEWAY_NAME}: ${formatPrice(o.total)} via ${s.paymentMode ?? "?"}, payment ${s.transactionId ?? "?"}${s.utr ? `, UTR ${s.utr}` : ""}${o.couponCode ? `; code ${o.couponCode} used` : ""}`,
      });
    } else if (["cancelled", "expired", "payment_failed"].includes(o.status)) {
      // Paid after the order was closed: give the money back.
      await tx.update(onlineOrders).set({ ...base, ...pay, status: "refunding", refundReason: "Paid after the order was closed" }).where(eq(onlineOrders.id, o.id));
      await audit(tx, RAZORPAY, { action: "online_order.late_payment", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber} was paid (${formatPrice(o.total)}) after it was ${o.status}; refunding automatically` });
      refundAfter = true;
    } else {
      await tx.update(onlineOrders).set({ ...base, gatewayState: "COMPLETED" }).where(eq(onlineOrders.id, o.id));
    }
  });
  if (refundAfter) await startRefund(orderId, RAZORPAY).catch((err) => console.error("[razorpay] automatic refund failed to start", err));
}

/** Reconcile every Razorpay order still waiting on an answer (called from staff pages and the cron). */
export async function reconcileOpenOrders(limit = 25) {
  if (!gatewayEnabled()) return;
  const db = getDb();
  const rows = await db
    .select({ id: onlineOrders.id })
    .from(onlineOrders)
    .where(
      and(
        eq(onlineOrders.paymentMethod, "razorpay"),
        isNotNull(onlineOrders.gatewayOrderId),
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

/** Begin (or retry) a full refund of a Razorpay-paid order that is in "refunding". */
async function startRefund(orderId: string, actor: AuditActor) {
  const db = getDb();
  const prepared = await db.transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, orderId)).for("update");
    if (!o || o.status !== "refunding" || !o.gatewayTransactionId) return null;
    if (!canStartRefund(o)) return null; // one refund at a time
    const n = o.refundAttempt + 1;
    const merchantRefundId = `${o.orderNumber}-R${n}`;
    await tx.update(onlineOrders).set({ refundAttempt: n, refundMerchantId: merchantRefundId, refundState: "STARTING", refundAmount: o.total, updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
    return { o, merchantRefundId };
  });
  if (!prepared) return;
  const { o, merchantRefundId } = prepared;
  try {
    const r = await client().refund({ merchantRefundId, paymentId: o.gatewayTransactionId, amountPaise: toPaise(o.total), note: o.orderNumber });
    await db.transaction(async (tx) => {
      await tx.update(onlineOrders).set({ refundGatewayId: r.refundId, refundState: r.state, updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
      await audit(tx, actor, { action: "online_order.refund_started", entityType: "online_order", entityId: o.id, summary: `Refund ${merchantRefundId} of ${formatPrice(o.total)} sent to ${GATEWAY_NAME} for ${o.orderNumber} (${r.state})` });
    });
    // Some refunds are already done in Razorpay's first answer.
    if (r.state === "COMPLETED") await reconcileRefund(o.id).catch((err) => console.error("[razorpay] refund check failed", err));
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
  if (!o.refundMerchantId || !o.refundGatewayId || o.refundState === "FAILED" || o.refundState === "STARTING") return;
  let r: Awaited<ReturnType<RazorpayClient["refundStatus"]>>;
  try {
    r = await client().refundStatus(o.refundGatewayId);
  } catch (err) {
    console.error("[razorpay] refund status failed", o.orderNumber, err);
    return;
  }
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, orderId)).for("update");
    if (!cur || cur.status !== "refunding" || cur.refundMerchantId !== o.refundMerchantId) return;
    if (r.state === "COMPLETED") {
      await tx.update(onlineOrders).set({ status: "refunded", refundState: "COMPLETED", refundedAt: new Date(), updatedAt: new Date() }).where(eq(onlineOrders.id, cur.id));
      // The sale didn't happen, so a code it used can be given out again.
      if (cur.couponId) await tx.update(coupons).set({ status: "active", orderId: null, usedAt: null }).where(and(eq(coupons.id, cur.couponId), eq(coupons.orderId, cur.id)));
      await audit(tx, RAZORPAY, { action: "online_order.refunded", entityType: "online_order", entityId: cur.id, summary: `Refund ${cur.refundMerchantId} of ${formatPrice(cur.total)} for ${cur.orderNumber} completed` });
    } else if (r.state === "FAILED") {
      await tx.update(onlineOrders).set({ refundState: "FAILED", updatedAt: new Date() }).where(eq(onlineOrders.id, cur.id));
      await audit(tx, RAZORPAY, { action: "online_order.refund_failed", entityType: "online_order", entityId: cur.id, summary: `Refund ${cur.refundMerchantId} for ${cur.orderNumber} failed at ${GATEWAY_NAME}; retry it from the order page` });
    } else if (r.state !== cur.refundState) {
      await tx.update(onlineOrders).set({ refundState: r.state, updatedAt: new Date() }).where(eq(onlineOrders.id, cur.id));
    }
  });
}

/** Staff: cancel a Razorpay-paid order and refund it in full, or retry a refund that failed. */
export async function refundOnlineOrder(actor: Actor, id: string, input: { reason: string }) {
  requirePermission(actor, "payments.refund");
  const reason = input.reason.trim();
  const db = getDb();
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, id)).for("update");
    if (!o) throw notFound("Online order");
    if (o.paymentMethod !== "razorpay") throw conflict("This order was paid by UPI QR; refund it at the counter.");
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

/** Staff: ask Razorpay now instead of waiting for the schedule. */
export async function checkGatewayNow(actor: Actor, id: string) {
  requirePermission(actor, ["orders.view", "payments.verify"]);
  await reconcileOrder(id, { force: true });
}

/** Rate limit for the customer-facing "ask Razorpay right now" actions (the page then falls back to the schedule). */
export async function mayAskNow(accountId: string) {
  try {
    await enforceRateLimit(`gateway-check:${accountId}`, 60, 10 * 60);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}
const text = (v: unknown) => (typeof v === "string" && v ? v : null);

/**
 * Razorpay's callback about a website order (order.paid, payment.*, refund.*). The caller has already checked
 * X-Razorpay-Signature over the raw body. The event only makes us ask Razorpay: an order changes from the API's
 * answer, never from what the callback says. Returns `matched: false` for events about something else (for
 * example the counter's QR payments), which the caller then handles.
 */
export async function handleRazorpayOrderEvent(rawBody: string, body: Record<string, unknown>): Promise<{ matched: boolean }> {
  const event = typeof body.event === "string" ? body.event : "unknown";
  if (!/^(order|payment|refund)\./.test(event)) return { matched: false };
  const payload = obj(body.payload);
  const order = obj(obj(payload?.order)?.entity);
  const payment = obj(obj(payload?.payment)?.entity);
  const refund = obj(obj(payload?.refund)?.entity);
  const receipt = text(order?.receipt);
  const gatewayOrderId = text(order?.id) ?? text(payment?.order_id);
  const refundId = text(refund?.id);
  const paymentId = text(refund?.payment_id) ?? text(payment?.id);

  const db = getDb();
  const find = async () => {
    if (gatewayOrderId) {
      const [r] = await db.select({ id: onlineOrders.id }).from(onlineOrders).where(eq(onlineOrders.gatewayOrderId, gatewayOrderId));
      if (r) return r;
    }
    if (receipt) {
      const [r] = await db.select({ id: onlineOrders.id }).from(onlineOrders).where(eq(onlineOrders.gatewayMerchantOrderId, receipt));
      if (r) return r;
    }
    if (refundId) {
      const [r] = await db.select({ id: onlineOrders.id }).from(onlineOrders).where(eq(onlineOrders.refundGatewayId, refundId));
      if (r) return r;
    }
    if (paymentId) {
      const [r] = await db.select({ id: onlineOrders.id }).from(onlineOrders).where(eq(onlineOrders.gatewayTransactionId, paymentId));
      if (r) return r;
    }
    return null;
  };
  const o = await find();
  if (!o) return { matched: false };
  await db
    .insert(paymentEvents)
    .values({
      provider: "razorpay",
      eventId: createHash("sha256").update(rawBody).digest("hex"),
      eventType: event.slice(0, 80),
      signatureValid: true,
      payload: body,
      processedAt: new Date(),
      result: "re-checked with the Razorpay API",
    })
    .onConflictDoNothing();
  if (event.startsWith("refund.")) await reconcileRefund(o.id);
  else await reconcileOrder(o.id, { force: true });
  return { matched: true };
}
