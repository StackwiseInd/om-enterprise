import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLogs, coupons, onlineOrders, paymentEvents } from "@/server/db/schema";
import { getSettings, saveSettings } from "@/server/settings";
import type { Actor } from "@/server/auth/actor";
import { createProduct, createVariant, setProductPublished, setProductReview } from "@/server/services/catalog";
import { proposePrice } from "@/server/services/pricing";
import { shopSignUp, type ShopAccount } from "@/server/services/shop-auth";
import { generateCoupons, getCouponBatch } from "@/server/services/coupons";
import { cancelMyOrder, getMyOrder, getOnlineOrder, onlinePaymentMode, payMyOrder, placeOnlineOrder, setOnlineOrderStatus, submitUtr, verifyOnlinePayment } from "@/server/services/online-orders";
import { __setPhonePeClientForTests, checkIntervalMs, handlePhonePeWebhook, reconcileOrder, refundOnlineOrder } from "@/server/services/online-payments";
import { __clearPhonePeTokenCache, PhonePeClient, phonePeConfigFromEnv } from "@/server/payments/phonepe";
import { FakePhonePe } from "../support/fake-phonepe";
import { client, firstCategoryId, makeUser, rejects, setRegistration, taxClassId } from "./helpers";

const ENV = {
  PHONEPE_CLIENT_ID: "TESTCLIENT",
  PHONEPE_CLIENT_SECRET: "test-secret",
  PHONEPE_CLIENT_VERSION: "1",
  PHONEPE_WEBHOOK_USERNAME: "omhook",
  PHONEPE_WEBHOOK_PASSWORD: "omhook-pass-123",
};
const SANDBOX = "https://api-preprod.phonepe.com/apis/pg-sandbox";
const goodAuth = createHash("sha256").update(`${ENV.PHONEPE_WEBHOOK_USERNAME}:${ENV.PHONEPE_WEBHOOK_PASSWORD}`).digest("hex");

let admin: Actor;
let sachin: Actor;
let itemA: string; // ₹600
let itemB: string; // ₹400
let fake: FakePhonePe;
let seq = 0;

const mobile = () => `8${String(Date.now() % 1_000_000_000).padStart(9, "0").slice(-7)}${String(seq++ % 100).padStart(2, "0")}`;
const cart = () => [
  { variantId: itemA, quantity: "1" },
  { variantId: itemB, quantity: "1" },
];

async function publishedItem(price: string) {
  const name = `Gateway ${Date.now().toString(36)}${seq++}`;
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
  const b = await generateCoupons(admin, { label: "Gateway ₹100 off", amountOff: "100", minOrder: "0", count: 1, validUntil: null });
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
const webhook = (event: string, payload: Record<string, unknown>, auth: string | null = goodAuth) => handlePhonePeWebhook(JSON.stringify({ event, payload }), auth);

beforeAll(async () => {
  Object.assign(process.env, ENV);
  delete process.env.PHONEPE_ENV;
  await setRegistration("regular");
  admin = await makeUser("super_admin");
  sachin = await makeUser("sales");
  // The UPI QR settings are off: PhonePe alone must be enough to sell online.
  const p = await getSettings("payments");
  await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "payments", { ...p, upiEnabled: false, gatewayProvider: "none" }));
  itemA = await publishedItem("600");
  itemB = await publishedItem("400");
});

beforeEach(() => {
  fake = new FakePhonePe();
  __clearPhonePeTokenCache();
  __setPhonePeClientForTests(new PhonePeClient(phonePeConfigFromEnv()!, fake.fetchFor(SANDBOX)));
});

afterAll(() => {
  __setPhonePeClientForTests(null);
  for (const k of Object.keys(ENV)) delete process.env[k];
});

describe("PhonePe checkout: ₹1,000 cart, ₹100 code", () => {
  it("opens PhonePe for exactly ₹900 and marks the order paid only on PhonePe's own status", async () => {
    expect(await onlinePaymentMode()).toBe("phonepe");
    const a = await customer();
    const code = await oneCode();
    const { orderNumber, payUrl } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    expect(payUrl).toContain("mercury-uat.phonepe.com");

    const pay = fake.calls.find((c) => c.path === "/checkout/v2/pay")!.body as Record<string, unknown>;
    expect(pay).toMatchObject({ merchantOrderId: `${orderNumber}-1`, amount: 90000, paymentFlow: { type: "PG_CHECKOUT", merchantUrls: { redirectUrl: `http://localhost:3000/my-orders/${orderNumber}?from=phonepe` } } });
    expect(pay.prefillUserLoginDetails).toEqual({ phoneNumber: a.mobile });

    const placed = await getMyOrder(a, orderNumber);
    expect(placed.order).toMatchObject({ status: "awaiting_payment", paymentMethod: "phonepe", total: "900.00", qrPayload: null, upiVpa: null, canPayNow: true });
    expect(await couponStatus(code)).toBe("reserved");
    // A UTR can't be typed in for a PhonePe order.
    expect((await rejects(submitUtr(a, orderNumber, "123456789012", client))).code).toBe("CONFLICT");

    // Back from PhonePe while the payment is still pending: nothing changes.
    expect((await getMyOrder(a, orderNumber, { fromGateway: true })).order.status).toBe("awaiting_payment");

    fake.pay(`${orderNumber}-1`);
    const paid = await getMyOrder(a, orderNumber, { fromGateway: true });
    expect(paid.order).toMatchObject({ status: "paid", gatewayPaymentMode: "UPI_INTENT", utr: fake.orders.get(`${orderNumber}-1`)!.utr, canPayNow: false });
    expect(await couponStatus(code)).toBe("used");
    // Staff don't verify PhonePe payments by hand.
    expect((await rejects(verifyOnlinePayment(sachin, (await row(orderNumber)).id, {}))).code).toBe("CONFLICT");

    await setOnlineOrderStatus(sachin, (await row(orderNumber)).id, { status: "ready" });
    expect(await actions(orderNumber)).toEqual(expect.arrayContaining(["online_order.place", "online_order.gateway_started", "online_order.payment_verified", "online_order.ready"]));
  });

  it("follows PhonePe's status-check schedule and doesn't ask before 20 seconds", async () => {
    expect(checkIntervalMs(10_000)).toBe(Infinity);
    expect(checkIntervalMs(25_000)).toBe(3_000);
    expect(checkIntervalMs(80_000)).toBe(6_000);
    expect(checkIntervalMs(150_000)).toBe(10_000);
    expect(checkIntervalMs(200_000)).toBe(30_000);
    expect(checkIntervalMs(10 * 60_000)).toBe(60_000);

    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    fake.pay(`${orderNumber}-1`);
    const before = fake.calls.length;
    expect((await getMyOrder(a, orderNumber)).order.status).toBe("awaiting_payment");
    expect(fake.calls.length).toBe(before);
    // 30 seconds later the scheduled check finds the payment.
    const o = await row(orderNumber);
    await getDb().update(onlineOrders).set({ gatewayExpiresAt: new Date(o.gatewayExpiresAt!.getTime() - 30_000) }).where(eq(onlineOrders.id, o.id));
    expect((await getMyOrder(a, orderNumber)).order.status).toBe("paid");
  });

  it("frees the code when the payment fails, and a second attempt with a new id pays", async () => {
    const a = await customer();
    const code = await oneCode();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    fake.fail(`${orderNumber}-1`);
    const failed = await getMyOrder(a, orderNumber, { fromGateway: true });
    expect(failed.order).toMatchObject({ status: "payment_failed", failureReason: "Wrong MPIN was entered" });
    expect(await couponStatus(code)).toBe("active");

    const { payUrl } = await payMyOrder(a, orderNumber, client);
    expect(payUrl).toContain(encodeURIComponent(`${orderNumber}-2`));
    expect((await row(orderNumber))).toMatchObject({ status: "awaiting_payment", gatewayAttempt: 2, gatewayMerchantOrderId: `${orderNumber}-2` });
    expect(await couponStatus(code)).toBe("reserved");
    // While an attempt is open, "pay" just returns the same page.
    expect((await payMyOrder(a, orderNumber, client)).payUrl).toBe(payUrl);

    // PhonePe tells us by webhook; the webhook only makes us ask.
    fake.pay(`${orderNumber}-2`, { paymentMode: "CARD" });
    expect(await webhook("checkout.order.completed", { merchantOrderId: `${orderNumber}-2`, state: "COMPLETED", amount: 90000 })).toMatchObject({ matched: true, verified: true });
    expect(await row(orderNumber)).toMatchObject({ status: "paid", gatewayPaymentMode: "CARD" });
    expect(await couponStatus(code)).toBe("used");
    expect(await actions(orderNumber)).toEqual(expect.arrayContaining(["online_order.payment_failed", "online_order.gateway_retry", "online_order.payment_verified"]));
  });

  it("can't be marked paid by a forged webhook", async () => {
    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    const forged = createHash("sha256").update("omhook:guess").digest("hex");
    fake.pay(`${orderNumber}-1`); // even if PhonePe really has it paid, a forged callback can't make us ask now
    const before = fake.calls.length;
    expect(await webhook("checkout.order.completed", { merchantOrderId: `${orderNumber}-1`, state: "COMPLETED", amount: 100000 }, forged)).toMatchObject({ matched: true, verified: false });
    expect(fake.calls.length).toBe(before);
    expect((await row(orderNumber)).status).toBe("awaiting_payment");
    const [ev] = await getDb().select().from(paymentEvents).where(eq(paymentEvents.eventId, createHash("sha256").update(JSON.stringify({ event: "checkout.order.completed", payload: { merchantOrderId: `${orderNumber}-1`, state: "COMPLETED", amount: 100000 } })).digest("hex")));
    expect(ev).toMatchObject({ provider: "phonepe", signatureValid: false, eventType: "checkout.order.completed" });
    expect(await webhook("checkout.order.completed", { merchantOrderId: "OL999999-1" })).toMatchObject({ matched: false });
    // Noise that is neither authorised nor about one of our orders isn't stored at all.
    const noise = JSON.stringify({ event: "checkout.order.completed", payload: { merchantOrderId: "OL888888-1" } });
    expect(await handlePhonePeWebhook(noise, forged)).toMatchObject({ ok: true, matched: false });
    expect(await getDb().select().from(paymentEvents).where(eq(paymentEvents.eventId, createHash("sha256").update(noise).digest("hex")))).toHaveLength(0);
    expect(await handlePhonePeWebhook("not json", goodAuth)).toMatchObject({ ok: false });
  });

  it("holds the order for a hand check when PhonePe reports a different amount", async () => {
    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    fake.pay(`${orderNumber}-1`, { amount: 100 });
    expect((await getMyOrder(a, orderNumber, { fromGateway: true })).order.status).toBe("payment_submitted");
    const o = await row(orderNumber);
    expect(o.verificationNote).toContain("PhonePe reports ₹1");
    expect(await actions(orderNumber)).toContain("online_order.gateway_amount_mismatch");
    await verifyOnlinePayment(sachin, o.id, { note: "Customer paid the rest in cash" });
    expect((await row(orderNumber)).status).toBe("paid");
  });

  it("marks the attempt failed and frees the code when PhonePe is down, then pays on a retry", async () => {
    const a = await customer();
    const code = await oneCode();
    fake.down = 503;
    expect((await rejects(placeOnlineOrder(a, { items: cart(), couponCode: code }, client))).message).toContain("PhonePe isn't responding");
    const [o] = await getDb().select().from(onlineOrders).where(eq(onlineOrders.accountId, a.id));
    expect(o).toMatchObject({ status: "payment_failed", gatewayState: "NOT_STARTED" });
    expect(await couponStatus(code)).toBe("active");
    fake.down = null;
    const { payUrl } = await payMyOrder(a, o.orderNumber, client);
    expect(payUrl).toContain("mercury-uat");
    expect(await couponStatus(code)).toBe("reserved");
  });
});

describe("refunds", () => {
  it("refunds a payment that arrives after the customer cancelled", async () => {
    const a = await customer();
    const code = await oneCode();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    await cancelMyOrder(a, orderNumber, client);
    expect(await couponStatus(code)).toBe("active");

    fake.pay(`${orderNumber}-1`);
    await webhook("checkout.order.completed", { merchantOrderId: `${orderNumber}-1`, state: "COMPLETED" });
    expect(await row(orderNumber)).toMatchObject({ status: "refunding", refundMerchantId: `${orderNumber}-R1`, refundState: "PENDING", refundAmount: "900.00" });
    expect(fake.refunds.get(`${orderNumber}-R1`)).toMatchObject({ originalMerchantOrderId: `${orderNumber}-1`, amount: 90000 });
    // The code was given back on cancelling; the late payment doesn't take it again.
    expect(await couponStatus(code)).toBe("active");

    fake.settleRefund(`${orderNumber}-R1`);
    await webhook("pg.refund.completed", { merchantRefundId: `${orderNumber}-R1`, originalMerchantOrderId: `${orderNumber}-1`, state: "COMPLETED" });
    const done = await getMyOrder(a, orderNumber);
    expect(done.order).toMatchObject({ status: "refunded", refundState: "COMPLETED" });
    expect(done.order.refundedAt).toBeTruthy();
    expect(await actions(orderNumber)).toEqual(expect.arrayContaining(["online_order.cancel", "online_order.late_payment", "online_order.refund_started", "online_order.refunded"]));
  });

  it("lets staff with refund rights cancel a paid order and refund it, retrying a refund PhonePe refused", async () => {
    const a = await customer();
    const code = await oneCode();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    fake.pay(`${orderNumber}-1`);
    await getMyOrder(a, orderNumber, { fromGateway: true });
    const id = (await row(orderNumber)).id;

    expect((await rejects(refundOnlineOrder(sachin, id, { reason: "Out of stock" }))).code).toBe("FORBIDDEN");
    expect((await rejects(refundOnlineOrder(admin, id, { reason: "" }))).code).toBe("VALIDATION");

    fake.refuseRefunds = 400;
    await expect(refundOnlineOrder(admin, id, { reason: "Item out of stock" })).rejects.toThrow();
    expect(await row(orderNumber)).toMatchObject({ status: "refunding", refundState: "FAILED", refundMerchantId: `${orderNumber}-R1` });

    fake.refuseRefunds = null;
    await refundOnlineOrder(admin, id, { reason: "retry" });
    expect(await row(orderNumber)).toMatchObject({ refundState: "PENDING", refundMerchantId: `${orderNumber}-R2` });
    // A second click while PhonePe is working on it is refused.
    expect((await rejects(refundOnlineOrder(admin, id, { reason: "again" }))).code).toBe("CONFLICT");

    fake.settleRefund(`${orderNumber}-R2`);
    await getOnlineOrder(admin, id); // opening the order page re-checks the refund
    expect(await row(orderNumber)).toMatchObject({ status: "refunded", refundState: "COMPLETED" });
    // The sale didn't happen, so the code can be handed out again.
    expect(await couponStatus(code)).toBe("active");
    expect(await actions(orderNumber)).toEqual(expect.arrayContaining(["online_order.refund_requested", "online_order.refund_failed", "online_order.refund_retry", "online_order.refund_started", "online_order.refunded"]));
  });

  it("only refunds PhonePe orders that were paid and not collected", async () => {
    const a = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: cart() }, client);
    const id = (await row(orderNumber)).id;
    expect((await rejects(refundOnlineOrder(admin, id, { reason: "Not paid yet" }))).code).toBe("CONFLICT");
    fake.pay(`${orderNumber}-1`);
    await reconcileOrder(id, { force: true });
    await setOnlineOrderStatus(sachin, id, { status: "collected" });
    expect((await rejects(refundOnlineOrder(admin, id, { reason: "Changed mind" }))).code).toBe("CONFLICT");
  });
});
