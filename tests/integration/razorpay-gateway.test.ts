import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLogs, coupons, onlineOrders, paymentEvents } from "@/server/db/schema";
import { getSettings, saveSettings } from "@/server/settings";
import type { Actor } from "@/server/auth/actor";
import { createProduct, createVariant, setProductPublished, setProductReview } from "@/server/services/catalog";
import { proposePrice } from "@/server/services/pricing";
import { customerAuditActor, shopSignUp, type ShopAccount } from "@/server/services/shop-auth";
import { generateCoupons, getCouponBatch } from "@/server/services/coupons";
import { cancelMyOrder, getMyOrder, getOnlineOrder, onlinePaymentMode, payMyOrder, placeOnlineOrder, setOnlineOrderStatus, submitUtr, verifyOnlinePayment } from "@/server/services/online-orders";
import { __setRazorpayClientForTests, checkIntervalMs, GATEWAY_TIMEOUT_REASON, reconcileOrder, refundOnlineOrder, verifyCheckoutPayment } from "@/server/services/online-payments";
import { handleGatewayWebhook } from "@/server/services/payments";
import { RazorpayClient, razorpayConfigFromEnv } from "@/server/payments/razorpay";
import { FakeRazorpay } from "../support/fake-razorpay";
import { client, firstCategoryId, makeUser, rejects, setRegistration, taxClassId } from "./helpers";

const WEBHOOK_SECRET = "whsec-test-0123456789";

let admin: Actor;
let sachin: Actor;
let itemA: string; // ₹600
let itemB: string; // ₹400
let fake: FakeRazorpay;
let seq = 0;

const mobile = () => `8${String(Date.now() % 1_000_000_000).padStart(9, "0").slice(-7)}${String(seq++ % 100).padStart(2, "0")}`;
const cart = () => [
  { variantId: itemA, quantity: "1" },
  { variantId: itemB, quantity: "1" },
];

async function publishedItem(price: string) {
  const name = `Razorpay ${Date.now().toString(36)}${seq++}`;
  const p = await createProduct(admin, { name, categoryId: await firstCategoryId(), unitCode: "pcs", taxClassId: await taxClassId("18"), hsnCode: "3917" });
  const v = await createVariant(admin, p.id, { sku: `SKU-${name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`, name: "Std", unitCode: "pcs" });
  await proposePrice(admin, { variantId: v.id, price, priceIncludesTax: true, reason: "test price" });
  await setProductReview(admin, p.id, "approved");
  await setProductPublished(admin, p.id, true);
  return v.id;
}

async function customer(): Promise<ShopAccount> {
  return (await shopSignUp({ name: "Meena Joshi", mobile: mobile(), password: "meena-12345" }, { ...client, ip: `10.8.${seq % 250}.${seq++ % 250}` })).account;
}
async function oneCode() {
  const b = await generateCoupons(admin, { label: "Razorpay ₹100 off", amountOff: "100", minOrder: "0", count: 1, validUntil: null });
  return (await getCouponBatch(admin, b.id)).codes[0].code;
}
async function row(orderNumber: string) {
  const [o] = await getDb().select().from(onlineOrders).where(eq(onlineOrders.orderNumber, orderNumber));
  return o;
}
async function couponStatus(code: string) {
  const [c] = await getDb().select().from(coupons).where(eq(coupons.code, code));
  return c.status;
}
async function actions(orderNumber: string) {
  const o = await row(orderNumber);
  return (await getDb().select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, o.id))).map((a) => a.action);
}
/** A signed webhook, as Razorpay sends it. */
const webhook = (raw: string, secret = WEBHOOK_SECRET) => handleGatewayWebhook("razorpay", raw, new Headers({ "x-razorpay-signature": FakeRazorpay.signWebhook(raw, secret), "x-razorpay-event-id": `evt_${Date.now()}${seq++}` }));
/** What checkout.js returns after a payment, sent to our verify endpoint's service. */
const verify = (a: ShopAccount, orderNumber: string, orderId: string, paymentId: string, signature = fake.signCheckout(orderId, paymentId)) =>
  verifyCheckoutPayment(a.id, orderNumber, { orderId, paymentId, signature }, customerAuditActor(a, client));

beforeAll(async () => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_FAKEKEY123";
  process.env.RAZORPAY_KEY_SECRET = "fake-secret-0123456789";
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  await setRegistration("regular");
  admin = await makeUser("super_admin");
  sachin = await makeUser("sales");
  // The UPI QR settings are off: Razorpay alone must be enough to sell online.
  const p = await getSettings("payments");
  await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "payments", { ...p, upiEnabled: false, gatewayProvider: "none" }));
  itemA = await publishedItem("600");
  itemB = await publishedItem("400");
});

beforeEach(() => {
  fake = new FakeRazorpay();
  __setRazorpayClientForTests(new RazorpayClient(razorpayConfigFromEnv()!, fake.fetchFor()));
});

afterAll(() => {
  __setRazorpayClientForTests(null);
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
});

describe("Razorpay checkout: ₹1,000 cart, ₹100 code", () => {
  it("creates a Razorpay order for exactly ₹900 and marks it paid only after the signature AND Razorpay agree", async () => {
    expect(await onlinePaymentMode()).toBe("razorpay");
    const a = await customer();
    const code = await oneCode();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);

    const create = fake.calls.find((c) => c.path === "/v1/orders")!;
    expect(create.body).toMatchObject({ amount: 90000, currency: "INR", receipt: `${orderNumber}-1` });
    expect(create.headers.Authorization).toMatch(/^Basic /);

    const placed = (await getMyOrder(a, orderNumber)).order;
    expect(placed).toMatchObject({ status: "awaiting_payment", paymentMethod: "razorpay", total: "900.00", qrPayload: null, upiVpa: null, canPayNow: true });
    expect(await couponStatus(code)).toBe("reserved");

    // The page gets the PUBLIC key id and the order, never the secret.
    const { checkout } = await payMyOrder(a, orderNumber, client);
    expect(checkout).toMatchObject({ keyId: fake.keyId, amount: 90000, currency: "INR", description: `Order ${orderNumber}`, prefill: { name: "Meena Joshi", contact: a.mobile } });
    expect(JSON.stringify(checkout)).not.toContain(fake.keySecret);
    const rzpOrder = checkout.orderId;

    // A UTR can't be typed in for a Razorpay order.
    expect((await rejects(submitUtr(a, orderNumber, "123456789012", client))).code).toBe("CONFLICT");

    // A signature that doesn't match is a 400 and changes nothing, even if Razorpay does hold a payment.
    const p = fake.pay(rzpOrder, { method: "upi" });
    expect((await rejects(verify(a, orderNumber, rzpOrder, p.id, "0".repeat(64)))).code).toBe("BAD_REQUEST");
    expect((await rejects(verify(a, orderNumber, "order_SOMEONEELSES1", p.id, fake.signCheckout("order_SOMEONEELSES1", p.id)))).code).toBe("BAD_REQUEST");
    expect((await row(orderNumber)).status).toBe("awaiting_payment");
    expect(await couponStatus(code)).toBe("reserved");

    // The right signature makes the server ask Razorpay, which confirms the captured ₹900.
    expect((await verify(a, orderNumber, rzpOrder, p.id)).status).toBe("paid");
    const paid = (await getMyOrder(a, orderNumber)).order;
    expect(paid).toMatchObject({ status: "paid", gatewayPaymentMode: "UPI", utr: p.rrn, canPayNow: false });
    expect(await couponStatus(code)).toBe("used");
    // Staff don't verify Razorpay payments by hand.
    expect((await rejects(verifyOnlinePayment(sachin, (await row(orderNumber)).id, {}))).code).toBe("CONFLICT");
    await setOnlineOrderStatus(sachin, (await row(orderNumber)).id, { status: "ready" });
    expect(await actions(orderNumber)).toEqual(expect.arrayContaining(["online_order.place", "online_order.gateway_started", "online_order.payment_signature_invalid", "online_order.payment_verified", "online_order.ready"]));
  });

  it("isn't fooled by a good signature when Razorpay doesn't hold captured money", async () => {
    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    const { checkout } = await payMyOrder(a, orderNumber, client);
    const p = fake.pay(checkout.orderId, { status: "authorized" }); // authorised, not captured
    expect((await verify(a, orderNumber, checkout.orderId, p.id)).status).toBe("awaiting_payment");
    expect((await row(orderNumber)).status).toBe("awaiting_payment");
  });

  it("follows the check schedule and doesn't ask Razorpay before 20 seconds", async () => {
    expect(checkIntervalMs(10_000)).toBe(Infinity);
    expect(checkIntervalMs(25_000)).toBe(3_000);
    expect(checkIntervalMs(80_000)).toBe(6_000);
    expect(checkIntervalMs(150_000)).toBe(10_000);
    expect(checkIntervalMs(200_000)).toBe(30_000);
    expect(checkIntervalMs(10 * 60_000)).toBe(60_000);

    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    fake.pay(fake.orderByReceipt(`${orderNumber}-1`)!.id);
    const before = fake.calls.length;
    expect((await getMyOrder(a, orderNumber)).order.status).toBe("awaiting_payment");
    expect(fake.calls.length).toBe(before);
    // 30 seconds in, the scheduled check finds the payment.
    const o = await row(orderNumber);
    await getDb().update(onlineOrders).set({ gatewayExpiresAt: new Date(o.gatewayExpiresAt!.getTime() - 30_000) }).where(eq(onlineOrders.id, o.id));
    expect((await getMyOrder(a, orderNumber)).order.status).toBe("paid");
  });

  it("frees the code when time runs out, and a retry reuses the same Razorpay order", async () => {
    const a = await customer();
    const code = await oneCode();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    const first = (await payMyOrder(a, orderNumber, client)).checkout.orderId;
    fake.failAttempt(first); // a wrong PIN inside the window is just a failed try there

    await getDb().update(onlineOrders).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(onlineOrders.orderNumber, orderNumber));
    const timedOut = (await getMyOrder(a, orderNumber)).order;
    expect(timedOut).toMatchObject({ status: "payment_failed", failureReason: GATEWAY_TIMEOUT_REASON });
    expect(await couponStatus(code)).toBe("active");

    const retry = (await payMyOrder(a, orderNumber, client)).checkout;
    expect(retry.orderId).toBe(first); // no second Razorpay order to leave behind
    expect(fake.calls.filter((c) => c.method === "POST" && c.path === "/v1/orders")).toHaveLength(1);
    expect(await row(orderNumber)).toMatchObject({ status: "awaiting_payment", gatewayAttempt: 2 });
    expect(await couponStatus(code)).toBe("reserved");
    // While a try is open, "pay" just returns the same order.
    expect((await payMyOrder(a, orderNumber, client)).checkout.orderId).toBe(first);

    const p = fake.pay(first, { method: "card" });
    expect((await verify(a, orderNumber, first, p.id)).status).toBe("paid");
    expect(await row(orderNumber)).toMatchObject({ status: "paid", gatewayPaymentMode: "CARD" });
    expect(await couponStatus(code)).toBe("used");
    expect(await actions(orderNumber)).toEqual(expect.arrayContaining(["online_order.expire", "online_order.gateway_retry", "online_order.payment_verified"]));
  });

  it("holds the order for a hand check when Razorpay reports a different amount", async () => {
    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    const { checkout } = await payMyOrder(a, orderNumber, client);
    const p = fake.pay(checkout.orderId, { amount: 100 });
    expect((await verify(a, orderNumber, checkout.orderId, p.id)).status).toBe("payment_submitted");
    const o = await row(orderNumber);
    expect(o.verificationNote).toContain("Razorpay reports ₹1");
    expect(await actions(orderNumber)).toContain("online_order.gateway_amount_mismatch");
    await verifyOnlinePayment(sachin, o.id, { note: "Customer paid the rest in cash" });
    expect((await row(orderNumber)).status).toBe("paid");
  });

  it("marks the order failed and frees the code when Razorpay is down at checkout, then works on a retry", async () => {
    const a = await customer();
    const code = await oneCode();
    fake.down = 503;
    expect((await rejects(placeOnlineOrder(a, { items: cart(), couponCode: code }, client))).message).toContain("Razorpay isn't responding");
    const [o] = await getDb().select().from(onlineOrders).where(eq(onlineOrders.accountId, a.id));
    expect(o).toMatchObject({ status: "payment_failed", gatewayState: "NOT_STARTED", gatewayOrderId: null });
    expect(await couponStatus(code)).toBe("active");
    fake.down = null;
    const { checkout } = await payMyOrder(a, o.orderNumber, client);
    expect(checkout.orderId).toMatch(/^order_/);
    expect(await couponStatus(code)).toBe("reserved");
  });
});

describe("Razorpay webhook", () => {
  it("only makes the server ask Razorpay; a bad signature is refused and changes nothing", async () => {
    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    const rzpOrder = fake.orderByReceipt(`${orderNumber}-1`)!.id;
    fake.pay(rzpOrder);
    const raw = fake.orderPaidEvent(rzpOrder);

    const forged = await handleGatewayWebhook("razorpay", raw, new Headers({ "x-razorpay-signature": FakeRazorpay.signWebhook(raw, "not-the-secret") }));
    expect(forged).toEqual({ outcome: "invalid_signature", status: 401 });
    expect((await row(orderNumber)).status).toBe("awaiting_payment");

    expect(await webhook(raw)).toEqual({ outcome: "processed", status: 200 });
    expect((await row(orderNumber)).status).toBe("paid");
    const events = await getDb().select().from(paymentEvents).where(eq(paymentEvents.provider, "razorpay"));
    expect(events.some((e) => e.eventType === "order.paid" && e.signatureValid)).toBe(true);
  });

  it("leaves other events (the counter's QR payments) to their own handler", async () => {
    const raw = JSON.stringify({ event: "qr_code.credited", created_at: 1, payload: { qr_code: { entity: { id: "qr_NOSUCH" } }, payment: { entity: { id: "pay_NOSUCH", amount: 100, currency: "INR", status: "captured" } } } });
    const r = await webhook(raw);
    expect(r.outcome).toBe("unknown_payment");
  });
});

describe("refunds", () => {
  it("refunds a payment that arrives after the customer cancelled, and gives the code back", async () => {
    const a = await customer();
    const code = await oneCode();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    const rzpOrder = fake.orderByReceipt(`${orderNumber}-1`)!.id;
    await cancelMyOrder(a, orderNumber, client);
    expect(await couponStatus(code)).toBe("active");

    const p = fake.pay(rzpOrder);
    await webhook(fake.orderPaidEvent(rzpOrder));
    expect(await row(orderNumber)).toMatchObject({ status: "refunding", refundMerchantId: `${orderNumber}-R1`, refundState: "PENDING", refundAmount: "900.00", gatewayTransactionId: p.id });
    const refundCall = fake.calls.find((c) => c.path === `/v1/payments/${p.id}/refund`)!;
    expect(refundCall.body).toMatchObject({ amount: 90000, speed: "normal" });
    expect(refundCall.headers["X-Refund-Idempotency"]).toBe(`omr-${orderNumber}-R1`);
    // The late payment doesn't take the code again.
    expect(await couponStatus(code)).toBe("active");

    const refundId = [...fake.refunds.keys()][0];
    fake.settleRefund(refundId);
    await webhook(fake.refundEvent(refundId, "refund.processed"));
    const done = await getMyOrder(a, orderNumber);
    expect(done.order).toMatchObject({ status: "refunded", refundState: "COMPLETED" });
    expect(await actions(orderNumber)).toEqual(expect.arrayContaining(["online_order.cancel", "online_order.late_payment", "online_order.refund_started", "online_order.refunded"]));
  });

  it("lets staff with refund rights cancel a paid order and refund it, retrying a refund Razorpay refused", async () => {
    const a = await customer();
    const code = await oneCode();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    const rzpOrder = fake.orderByReceipt(`${orderNumber}-1`)!.id;
    const p = fake.pay(rzpOrder);
    await verify(a, orderNumber, rzpOrder, p.id);
    const id = (await row(orderNumber)).id;

    expect((await rejects(refundOnlineOrder(sachin, id, { reason: "Out of stock" }))).code).toBe("FORBIDDEN");
    expect((await rejects(refundOnlineOrder(admin, id, { reason: "" }))).code).toBe("VALIDATION");

    fake.refuseRefunds = 400;
    await expect(refundOnlineOrder(admin, id, { reason: "Item out of stock" })).rejects.toThrow();
    expect(await row(orderNumber)).toMatchObject({ status: "refunding", refundState: "FAILED", refundMerchantId: `${orderNumber}-R1` });

    fake.refuseRefunds = null;
    await refundOnlineOrder(admin, id, { reason: "retry" });
    expect(await row(orderNumber)).toMatchObject({ refundState: "PENDING", refundMerchantId: `${orderNumber}-R2` });
    // A second click while Razorpay is working on it is refused.
    expect((await rejects(refundOnlineOrder(admin, id, { reason: "again" }))).code).toBe("CONFLICT");

    fake.settleRefund((await row(orderNumber)).refundGatewayId!);
    await getOnlineOrder(admin, id); // opening the order page re-checks the refund
    expect(await row(orderNumber)).toMatchObject({ status: "refunded", refundState: "COMPLETED" });
    expect(await couponStatus(code)).toBe("active");
    expect(await actions(orderNumber)).toEqual(expect.arrayContaining(["online_order.refund_requested", "online_order.refund_failed", "online_order.refund_retry", "online_order.refund_started", "online_order.refunded"]));
  });

  it("only refunds Razorpay orders that were paid and not collected", async () => {
    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    const id = (await row(orderNumber)).id;
    expect((await rejects(refundOnlineOrder(admin, id, { reason: "Not paid yet" }))).code).toBe("CONFLICT");
    fake.pay(fake.orderByReceipt(`${orderNumber}-1`)!.id);
    await reconcileOrder(id, { force: true });
    await setOnlineOrderStatus(sachin, id, { status: "collected" });
    expect((await rejects(refundOnlineOrder(admin, id, { reason: "Changed mind" }))).code).toBe("CONFLICT");
  });
});
