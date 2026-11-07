import "server-only";
import { and, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, type Tx } from "@/server/db/client";
import { auditLogs, coupons, onlineOrderLines, onlineOrders, users, type OnlineOrderStatus } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { auditActorOf, requirePermission, type Actor } from "@/server/auth/actor";
import { conflict, invalid, notFound, precondition } from "@/server/errors";
import { enforceRateLimit, hashIp } from "@/server/rate-limit";
import { getSettings } from "@/server/settings";
import { pricePublicCart } from "@/server/services/public-catalog";
import { evaluateCoupon, releaseCoupon, type AppliedCoupon } from "@/server/services/coupons";
import { customerAuditActor, type ShopAccount } from "@/server/services/shop-auth";
import { GATEWAY_PAY_SECONDS, GATEWAY_TIMEOUT_REASON, gatewayEnabled, mayAskNow, openGatewayCheckout, reconcileOpenOrders, reconcileOrder, retryGatewayPayment, type CheckoutParams } from "@/server/services/online-payments";
import { gatewayName, isGatewayMethod, type PaymentMethod } from "@/lib/gateway";
import { hasReceipt, receiptCodeFor } from "@/server/services/online-receipt";
import { buildUpiUri, isValidUpiUtr } from "@/lib/india";
import { D, formatPrice, m } from "@/lib/money";

/**
 * Online orders: a signed-in customer checks out the cart (optionally with a discount code), pays
 * the exact amount by UPI QR and sends the UTR. A plain UPI ID gives no way for software to see
 * the money arrive, so the shop confirms it in its bank/UPI app before the order counts as paid.
 * The system does every check it can on its own: the amount is fixed in the QR, the UTR must be
 * 12 digits and never used before (on another order or any confirmed counter payment), and the
 * order must still be open. Collection is at the store only.
 */

export const PAY_WITHIN_MINUTES = 60;
const MAX_OPEN_ORDERS = 3;
/** Most UPI payments are capped at ₹1,00,000 each. */
const MAX_ORDER_TOTAL = D(100000);

type Item = { variantId: string; quantity: string };
type Client = { ip: string; userAgent: string };

const LIVE: OnlineOrderStatus[] = ["awaiting_payment", "payment_submitted", "paid", "ready"];

/**
 * Orders whose time to pay has run out. A UPI-QR order becomes "expired". A Razorpay order becomes "failed"
 * (the customer can try again on the same Razorpay order); it stays watched, so a payment that still arrives
 * is refunded. In both cases the discount code is freed.
 */
export async function expireStaleOrders(tx: Tx) {
  const gone = await tx
    .update(onlineOrders)
    .set({ status: sql`case when ${onlineOrders.paymentMethod} = 'razorpay' then 'payment_failed' else 'expired' end`, failureReason: sql`case when ${onlineOrders.paymentMethod} = 'razorpay' then ${GATEWAY_TIMEOUT_REASON} else ${onlineOrders.failureReason} end`, updatedAt: new Date() })
    .where(and(eq(onlineOrders.status, "awaiting_payment"), lt(onlineOrders.expiresAt, new Date())))
    .returning({ id: onlineOrders.id, couponId: onlineOrders.couponId, orderNumber: onlineOrders.orderNumber, paymentMethod: onlineOrders.paymentMethod });
  for (const o of gone) {
    await releaseCoupon(tx, o.couponId);
    await audit(tx, { userId: null, label: "system" }, { action: "online_order.expire", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber} ${o.paymentMethod === "razorpay" ? "timed out" : "expired"}: not paid in time` });
  }
}

async function priceForCheckout(items: Item[]) {
  if (!items.length) throw invalid("Your cart is empty");
  const priced = await pricePublicCart(items);
  if (priced.lines.length !== items.length) throw invalid("Some items in your cart are no longer available. Please refresh your cart.");
  if (!priced.allPriced) throw invalid("Some items have no online price yet. Remove them, or send the cart as an order request and we'll quote.");
  if (priced.lines.some((l) => l.isSample)) throw invalid("Demonstration (sample) items can't be ordered.");
  return priced;
}

function totals(subtotal: string, coupon: AppliedCoupon | null) {
  const discount = coupon ? D(coupon.amountOff) : D(0);
  return { subtotal, discount: m(discount), total: m(D(subtotal).minus(discount)) };
}

async function upiConfig() {
  const p = await getSettings("payments");
  if (!p.upiEnabled || !p.upiVpa) throw precondition("Online payment isn't available right now. Please send your cart as an order request instead.");
  return p;
}

/** Online payment is offered through Razorpay or, until it is set up, the shop's UPI QR. */
export async function onlinePaymentMode(): Promise<PaymentMethod | null> {
  if (gatewayEnabled()) return "razorpay";
  const p = await getSettings("payments");
  return p.upiEnabled && p.upiVpa ? "upi_manual" : null;
}

/** What the checkout page shows: priced lines, the code's discount (if valid) and the amount to pay. */
export async function previewCheckout(account: ShopAccount, input: { items: Item[]; couponCode?: string | null }, client: Client) {
  const priced = await priceForCheckout(input.items);
  let coupon: AppliedCoupon | null = null;
  if (input.couponCode?.trim()) {
    await enforceRateLimit(`coupon-check:${account.id}`, 15, 15 * 60, "Too many code attempts. Please wait 15 minutes.");
    await enforceRateLimit(`coupon-check-ip:${hashIp(client.ip)}`, 30, 15 * 60, "Too many code attempts. Please wait 15 minutes.");
    coupon = await getDb().transaction((tx) => evaluateCoupon(tx, input.couponCode!, priced.total));
  }
  return { lines: priced.lines, coupon: coupon && { code: coupon.code, amountOff: coupon.amountOff }, ...totals(priced.total, coupon) };
}

export async function placeOnlineOrder(account: ShopAccount, input: { items: Item[]; couponCode?: string | null }, client: Client) {
  await enforceRateLimit(`online-order:${account.id}`, 10, 60 * 60, "Too many orders in an hour. Please wait a little.");
  const gateway = gatewayEnabled();
  const pay = gateway ? null : await upiConfig();
  const priced = await priceForCheckout(input.items);
  const db = getDb();
  const placed = await db.transaction(async (tx) => {
    await expireStaleOrders(tx);
    const [open] = await tx
      .select({ c: sql<number>`count(*)::int` })
      .from(onlineOrders)
      .where(and(eq(onlineOrders.accountId, account.id), eq(onlineOrders.status, "awaiting_payment")));
    if (open.c >= MAX_OPEN_ORDERS) throw precondition("You already have orders waiting for payment. Pay or cancel one of them first (My orders).");

    const coupon = input.couponCode?.trim() ? await evaluateCoupon(tx, input.couponCode, priced.total, { lock: true }) : null;
    const t = totals(priced.total, coupon);
    if (D(t.total).gt(MAX_ORDER_TOTAL)) throw invalid("Orders above ₹1,00,000 can't be paid in one UPI payment. Please call the shop.");

    const seq = await tx.execute<{ n: number }>(sql`select nextval('online_order_seq')::int as n`);
    const orderNumber = `OL${String(seq.rows[0].n).padStart(6, "0")}`;
    const qrPayload = pay
      ? buildUpiUri({
          vpa: pay.upiVpa,
          payeeName: pay.upiPayeeName || "OM ENTERPRISE",
          amount: D(t.total).toFixed(2),
          note: `Order ${orderNumber}`,
          merchantCode: pay.upiMerchantCode || null,
          reference: orderNumber,
        })
      : null;
    const [order] = await tx
      .insert(onlineOrders)
      .values({
        orderNumber,
        accountId: account.id,
        customerName: account.name,
        mobile: account.mobile,
        ...t,
        couponId: coupon?.id ?? null,
        couponCode: coupon?.code ?? null,
        paymentMethod: gateway ? "razorpay" : "upi_manual",
        upiVpa: pay?.upiVpa ?? null,
        qrPayload,
        gatewayAttempt: gateway ? 1 : 0,
        gatewayMerchantOrderId: gateway ? `${orderNumber}-1` : null,
        expiresAt: new Date(Date.now() + (gateway ? GATEWAY_PAY_SECONDS + 15 * 60 : PAY_WITHIN_MINUTES * 60) * 1000),
        ipHash: hashIp(client.ip),
      })
      .returning();
    await tx.insert(onlineOrderLines).values(
      priced.lines.map((l) => ({
        orderId: order.id,
        variantId: l.variantId,
        productName: l.productName,
        variantName: l.variantName,
        sku: l.sku,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice!,
        lineTotal: l.lineTotal!,
      })),
    );
    if (coupon) await tx.update(coupons).set({ status: "reserved", orderId: order.id }).where(eq(coupons.id, coupon.id));
    await audit(tx, customerAuditActor(account, client), {
      action: "online_order.place",
      entityType: "online_order",
      entityId: order.id,
      summary: `Placed ${orderNumber}: ${priced.lines.length} items, ${formatPrice(t.subtotal)}${coupon ? ` − ${formatPrice(t.discount)} (code ${coupon.code})` : ""} = ${formatPrice(t.total)} to pay ${gateway ? "on Razorpay" : "by UPI QR"}`,
      data: { subtotal: t.subtotal, discount: t.discount, total: t.total, couponCode: coupon?.code ?? null, method: gateway ? "razorpay" : "upi_manual" },
    });
    return { orderNumber, id: order.id };
  });
  // Razorpay's order is created after ours is safely stored (no network call inside the transaction). If it
  // can't be created, the attempt is marked failed, its code freed, and the customer sees why.
  if (gateway) await openGatewayCheckout(placed.id);
  return { orderNumber: placed.orderNumber };
}

/** The customer wants to pay: the checkout modal's parameters for the open Razorpay order, or a new try after a failed one. */
export async function payMyOrder(account: ShopAccount, orderNumber: string, client: Client): Promise<{ checkout: CheckoutParams }> {
  const db = getDb();
  const o = await findMyOrder(db, account, orderNumber);
  if (!isGatewayMethod(o.paymentMethod)) throw conflict("This order is paid by UPI QR on its page.");
  await enforceRateLimit(`gateway-pay:${account.id}`, 30, 10 * 60, "Too many attempts. Please wait a few minutes and try again.");
  await db.transaction((tx) => expireStaleOrders(tx));
  await reconcileOrder(o.id, { force: await mayAskNow(account.id) });
  const cur = await findMyOrder(db, account, orderNumber);
  if (cur.status === "awaiting_payment" && cur.gatewayExpiresAt && cur.gatewayExpiresAt.getTime() > Date.now() + 30_000) return { checkout: await openGatewayCheckout(cur.id) };
  if (cur.status === "payment_failed") return { checkout: await retryGatewayPayment(account.id, orderNumber, customerAuditActor(account, client)) };
  if (cur.status === "awaiting_payment") throw precondition("Razorpay is still confirming your last attempt. Please wait a minute and refresh.");
  throw conflict("This order doesn't need a payment.");
}

async function findMyOrder(tx: Tx, account: ShopAccount, orderNumber: string, lock = false) {
  const q = tx.select().from(onlineOrders).where(and(eq(onlineOrders.orderNumber, orderNumber), eq(onlineOrders.accountId, account.id)));
  const [o] = lock ? await q.for("update") : await q;
  if (!o) throw notFound("Order");
  return o;
}

export async function getMyOrder(account: ShopAccount, orderNumber: string) {
  const db = getDb();
  await db.transaction((tx) => expireStaleOrders(tx));
  let order = await findMyOrder(db, account, orderNumber);
  if (isGatewayMethod(order.paymentMethod)) {
    // Follow the check schedule (the payment window's own result asks straight away, via verify-payment).
    await reconcileOrder(order.id);
    order = await findMyOrder(db, account, orderNumber);
  }
  const lines = await db.select().from(onlineOrderLines).where(eq(onlineOrderLines.orderId, order.id));
  return { order: publicOrder(order), lines };
}

export async function listMyOrders(account: ShopAccount) {
  const db = getDb();
  await db.transaction((tx) => expireStaleOrders(tx));
  const rows = await db.select().from(onlineOrders).where(eq(onlineOrders.accountId, account.id)).orderBy(desc(onlineOrders.createdAt)).limit(50);
  return rows.map(publicOrder);
}

/** What the customer may see of their order (no IP hash, staff ids or notes). */
function publicOrder(o: typeof onlineOrders.$inferSelect) {
  return {
    orderNumber: o.orderNumber,
    status: o.status,
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    couponCode: o.couponCode,
    paymentMethod: o.paymentMethod,
    upiVpa: o.upiVpa,
    qrPayload: o.status === "awaiting_payment" ? o.qrPayload : null,
    canPayNow: isGatewayMethod(o.paymentMethod) && o.status === "awaiting_payment" && !!o.gatewayOrderId && !!o.gatewayExpiresAt && o.gatewayExpiresAt.getTime() > Date.now() + 30_000,
    gatewayPaymentMode: o.gatewayPaymentMode,
    gatewayState: o.gatewayState,
    refundState: o.refundState,
    refundedAt: o.refundedAt?.toISOString() ?? null,
    collectedAt: o.collectedAt?.toISOString() ?? null,
    /** The code printed on the payment receipt, for the shop to check. Only once the payment is confirmed. */
    receiptCode: hasReceipt(o.status) ? receiptCodeFor(o) : null,
    expiresAt: o.expiresAt.toISOString(),
    utr: o.utr ?? o.gatewayUtr,
    utrSubmittedAt: o.utrSubmittedAt?.toISOString() ?? null,
    verifiedAt: o.verifiedAt?.toISOString() ?? null,
    failureReason: o.failureReason,
    cancelReason: o.cancelReason,
    createdAt: o.createdAt.toISOString(),
  };
}

/** Is this UTR already confirmed against a counter payment (UPI or bank transfer)? */
async function utrUsedAtCounter(tx: Tx, utr: string) {
  const r = await tx.execute<{ n: number }>(
    sql`select count(*)::int as n from payments where method in ('upi','bank_transfer') and direction = 'in' and status = 'successful' and upper(reference) = upper(${utr})`,
  );
  return r.rows[0].n > 0;
}

export async function submitUtr(account: ShopAccount, orderNumber: string, rawUtr: string, client: Client) {
  await enforceRateLimit(`utr:${account.id}`, 10, 15 * 60, "Too many attempts. Please wait 15 minutes or contact the shop.");
  const utr = rawUtr.replace(/\s+/g, "");
  if (!isValidUpiUtr(utr)) throw invalid("The UPI transaction ID (UTR / UPI Ref. No.) is 12 digits. You'll find it in your UPI app's payment details.");
  const db = getDb();
  return db.transaction(async (tx) => {
    await expireStaleOrders(tx);
    const o = await findMyOrder(tx, account, orderNumber, true);
    if (o.paymentMethod !== "upi_manual") throw conflict(`This order is paid on ${gatewayName(o.paymentMethod)}; no UTR is needed.`);
    if (o.status === "expired") throw precondition("This order expired before the payment details arrived. If money was debited, contact the shop with your UTR.");
    if (o.status !== "awaiting_payment") throw conflict("Payment details for this order have already been sent.");
    const [dup] = await tx
      .select({ n: onlineOrders.orderNumber })
      .from(onlineOrders)
      .where(and(sql`upper(${onlineOrders.utr}) = upper(${utr})`, inArray(onlineOrders.status, ["payment_submitted", "paid", "ready", "collected"])));
    if (dup || (await utrUsedAtCounter(tx, utr))) {
      await audit(tx, customerAuditActor(account, client), { action: "online_order.utr_rejected", entityType: "online_order", entityId: o.id, summary: `UTR ${utr} refused for ${o.orderNumber}: already used for another payment` });
      throw conflict("This UTR has already been used for another payment. Check the number, or contact the shop.");
    }
    await tx.update(onlineOrders).set({ status: "payment_submitted", utr, utrSubmittedAt: new Date(), updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
    await audit(tx, customerAuditActor(account, client), {
      action: "online_order.utr_submitted",
      entityType: "online_order",
      entityId: o.id,
      summary: `UTR ${utr} sent for ${o.orderNumber} (${formatPrice(o.total)}); waiting for the shop to confirm the credit`,
    });
    return { status: "payment_submitted" as const };
  });
}

export async function cancelMyOrder(account: ShopAccount, orderNumber: string, client: Client) {
  const first = await findMyOrder(getDb(), account, orderNumber);
  // A gateway payment may have just gone through: ask before cancelling.
  if (isGatewayMethod(first.paymentMethod)) await reconcileOrder(first.id, { force: await mayAskNow(account.id) });
  await getDb().transaction(async (tx) => {
    const o = await findMyOrder(tx, account, orderNumber, true);
    if (o.status !== "awaiting_payment") throw conflict("Only an order that hasn't been paid can be cancelled here. Please contact the shop.");
    await tx.update(onlineOrders).set({ status: "cancelled", cancelledAt: new Date(), cancelReason: "Cancelled by the customer", updatedAt: new Date() }).where(eq(onlineOrders.id, o.id));
    await releaseCoupon(tx, o.couponId);
    await audit(tx, customerAuditActor(account, client), { action: "online_order.cancel", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber} cancelled by the customer before paying` });
  });
}

/* ------------------------------------------------------------------ */
/* Staff                                                               */
/* ------------------------------------------------------------------ */

export async function listOnlineOrders(actor: Actor, status?: OnlineOrderStatus | "to_verify", q?: string) {
  requirePermission(actor, ["orders.view", "payments.verify"]);
  const db = getDb();
  await db.transaction((tx) => expireStaleOrders(tx));
  await reconcileOpenOrders().catch((err) => console.error("[gateway] reconcile", err));
  const byStatus = status === "to_verify" ? eq(onlineOrders.status, "payment_submitted") : status ? eq(onlineOrders.status, status) : undefined;
  // Find an order from what a customer shows at the counter: its number, their name or mobile, or a payment reference.
  const term = q?.trim().slice(0, 60);
  const like = term ? `%${term.replace(/[\\%_]/g, "\\$&")}%` : null;
  const digits = term?.replace(/\D/g, "") ?? "";
  const bySearch = like
    ? or(ilike(onlineOrders.orderNumber, like), ilike(onlineOrders.customerName, like), ilike(onlineOrders.mobile, digits.length >= 3 ? `%${digits}%` : like), ilike(onlineOrders.gatewayTransactionId, like), ilike(onlineOrders.utr, like), ilike(onlineOrders.gatewayUtr, like), ilike(onlineOrders.couponCode, like))
    : undefined;
  const where = byStatus && bySearch ? and(byStatus, bySearch) : (byStatus ?? bySearch);
  return db
    .select({ o: onlineOrders, itemCount: sql<number>`(select count(*)::int from online_order_lines l where l.order_id = "online_orders"."id")` })
    .from(onlineOrders)
    .where(where)
    .orderBy(desc(onlineOrders.createdAt))
    .limit(300);
}

export async function onlineOrdersToVerify() {
  const [r] = await getDb().select({ c: sql<number>`count(*)::int` }).from(onlineOrders).where(eq(onlineOrders.status, "payment_submitted"));
  return r.c;
}

export async function getOnlineOrder(actor: Actor, id: string) {
  requirePermission(actor, ["orders.view", "payments.verify"]);
  const db = getDb();
  await db.transaction((tx) => expireStaleOrders(tx));
  await reconcileOrder(id).catch((err) => console.error("[gateway] reconcile", err));
  const handler = alias(users, "handler");
  const [row] = await db
    .select({ o: onlineOrders, verifiedByName: users.displayName, handledByName: handler.displayName })
    .from(onlineOrders)
    .leftJoin(users, eq(users.id, onlineOrders.verifiedBy))
    .leftJoin(handler, eq(handler.id, onlineOrders.handledBy))
    .where(eq(onlineOrders.id, id));
  if (!row) throw notFound("Online order");
  const lines = await db.select().from(onlineOrderLines).where(eq(onlineOrderLines.orderId, id));
  const history = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "online_order"), eq(auditLogs.entityId, id)))
    .orderBy(desc(auditLogs.at))
    .limit(100);
  return { order: { ...row.o, ipHash: undefined }, verifiedByName: row.verifiedByName, handledByName: row.handledByName, receiptCode: hasReceipt(row.o.status) ? receiptCodeFor(row.o) : null, lines, history };
}

async function lockOrder(tx: Tx, id: string) {
  const [o] = await tx.select().from(onlineOrders).where(eq(onlineOrders.id, id)).for("update");
  if (!o) throw notFound("Online order");
  return o;
}

/** The shop saw the exact amount arrive with this UTR in its bank/UPI app. */
export async function verifyOnlinePayment(actor: Actor, id: string, input: { note?: string | null }) {
  requirePermission(actor, "payments.verify");
  return getDb().transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (isGatewayMethod(o.paymentMethod) && !/ reports ₹/.test(o.verificationNote ?? "")) throw conflict(`${gatewayName(o.paymentMethod)} confirms this order's payment automatically.`);
    if (o.status !== "payment_submitted" || (!o.utr && !o.gatewayTransactionId)) throw conflict("This order has no payment waiting to be checked");
    if (o.utr && (await utrUsedAtCounter(tx, o.utr))) throw conflict(`UTR ${o.utr} is already confirmed against a counter payment`);
    const now = new Date();
    await tx
      .update(onlineOrders)
      .set({ status: "paid", verifiedBy: actor.id, verifiedAt: now, verificationNote: input.note?.trim() || null, handledBy: actor.id, updatedAt: now })
      .where(eq(onlineOrders.id, id));
    if (o.couponId) await tx.update(coupons).set({ status: "used", usedAt: now }).where(eq(coupons.id, o.couponId));
    await audit(tx, auditActorOf(actor), {
      action: "online_order.payment_verified",
      entityType: "online_order",
      entityId: id,
      summary: `Payment for ${o.orderNumber} verified: ${formatPrice(o.total)} received, ${o.utr ? `UTR ${o.utr}` : `${gatewayName(o.paymentMethod)} payment ${o.gatewayTransactionId}`}${o.couponCode ? `; code ${o.couponCode} used` : ""}`,
    });
  });
}

/** No matching credit: the order fails and any code goes back into circulation. */
export async function failOnlinePayment(actor: Actor, id: string, input: { reason: string }) {
  requirePermission(actor, "payments.verify");
  const reason = input.reason.trim();
  if (reason.length < 3) throw invalid("Say why, e.g. “No credit with this UTR in the bank app”");
  return getDb().transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    if (o.status !== "payment_submitted") throw conflict("This order has no payment waiting to be checked");
    await tx.update(onlineOrders).set({ status: "payment_failed", failureReason: reason.slice(0, 300), handledBy: actor.id, updatedAt: new Date() }).where(eq(onlineOrders.id, id));
    await releaseCoupon(tx, o.couponId);
    await audit(tx, auditActorOf(actor), { action: "online_order.payment_failed", entityType: "online_order", entityId: id, summary: `Payment for ${o.orderNumber} NOT found (UTR ${o.utr}): ${reason}` });
  });
}

export async function setOnlineOrderStatus(actor: Actor, id: string, input: { status: "ready" | "collected" | "cancelled"; reason?: string | null }) {
  requirePermission(actor, "orders.manage");
  return getDb().transaction(async (tx) => {
    const o = await lockOrder(tx, id);
    const now = new Date();
    if (input.status === "ready") {
      if (o.status !== "paid") throw conflict("Only a paid order can be marked ready");
      await tx.update(onlineOrders).set({ status: "ready", readyAt: now, handledBy: actor.id, updatedAt: now }).where(eq(onlineOrders.id, id));
    } else if (input.status === "collected") {
      if (!["paid", "ready"].includes(o.status)) throw conflict("Only a paid order can be handed over");
      // The remarks are the staff's own record of the handover ("took 2 tees and the glue, bill no. …").
      await tx.update(onlineOrders).set({ status: "collected", collectedAt: now, collectNote: input.reason?.trim().slice(0, 300) || null, handledBy: actor.id, updatedAt: now }).where(eq(onlineOrders.id, id));
    } else {
      if (!["awaiting_payment", "payment_submitted", "payment_failed"].includes(o.status)) throw conflict("A paid order can't be cancelled here; refund it at the counter first");
      const reason = input.reason?.trim();
      if (!reason) throw invalid("Say why the order is cancelled");
      await tx.update(onlineOrders).set({ status: "cancelled", cancelledAt: now, cancelReason: reason.slice(0, 300), handledBy: actor.id, updatedAt: now }).where(eq(onlineOrders.id, id));
      await releaseCoupon(tx, o.couponId);
    }
    await audit(tx, auditActorOf(actor), {
      action: `online_order.${input.status}`,
      entityType: "online_order",
      entityId: id,
      summary: `${o.orderNumber}: ${o.status} → ${input.status}${input.reason ? ` (${input.reason.trim()})` : ""}`,
    });
  });
}

export { LIVE as LIVE_ONLINE_ORDER_STATUSES };
