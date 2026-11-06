import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLogs, coupons, onlineOrders } from "@/server/db/schema";
import { getSettings, saveSettings } from "@/server/settings";
import type { Actor } from "@/server/auth/actor";
import { createProduct, createVariant, setProductPublished, setProductReview } from "@/server/services/catalog";
import { proposePrice } from "@/server/services/pricing";
import { shopAccountFromToken, shopSignIn, shopSignUp, type ShopAccount } from "@/server/services/shop-auth";
import { disableCoupons, generateCoupons, getCouponBatch, normalizeCouponCode } from "@/server/services/coupons";
import {
  cancelMyOrder,
  failOnlinePayment,
  getMyOrder,
  placeOnlineOrder,
  previewCheckout,
  setOnlineOrderStatus,
  submitUtr,
  verifyOnlinePayment,
} from "@/server/services/online-orders";
import { client, firstCategoryId, makeUser, rejects, setRegistration, taxClassId } from "./helpers";

let admin: Actor;
let sachin: Actor;
let itemA: string; // ₹600, published
let itemB: string; // ₹400, published
let seq = 0;

const mobile = () => `9${String(Date.now() % 1_000_000_000).padStart(9, "0").slice(-9, -2)}${String(seq++).padStart(2, "0")}`;
const utr = () => `${Date.now()}`.slice(-10) + String(seq++ % 100).padStart(2, "0");

async function publishedItem(price: string) {
  const name = `Shop ${Date.now().toString(36)}${seq++}`;
  const p = await createProduct(admin, { name, categoryId: await firstCategoryId(), unitCode: "pcs", taxClassId: await taxClassId("18"), hsnCode: "3917" });
  const v = await createVariant(admin, p.id, { sku: `SKU-${name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`, name: "Std", unitCode: "pcs" });
  await proposePrice(admin, { variantId: v.id, price, priceIncludesTax: true, reason: "test price" });
  await setProductReview(admin, p.id, "approved");
  await setProductPublished(admin, p.id, true);
  return v.id;
}

async function customer(): Promise<ShopAccount> {
  // Each test customer on its own address: sign-ups are limited per device.
  return (await shopSignUp({ name: "Ramesh Patel", mobile: mobile(), password: "ramesh-1234" }, { ...client, ip: `10.9.${seq % 250}.${seq++ % 250}` })).account;
}

async function batch(opts: { amountOff?: string; minOrder?: string; count?: number; validUntil?: string | null } = {}) {
  const b = await generateCoupons(admin, { label: "Test ₹100 off", amountOff: opts.amountOff ?? "100", minOrder: opts.minOrder ?? "0", count: opts.count ?? 3, validUntil: opts.validUntil ?? null });
  return (await getCouponBatch(admin, b.id)).codes.map((c) => c.code);
}

const cart = () => [
  { variantId: itemA, quantity: "1" },
  { variantId: itemB, quantity: "1" },
];

beforeAll(async () => {
  await setRegistration("regular");
  admin = await makeUser("super_admin");
  sachin = await makeUser("sales");
  const p = await getSettings("payments");
  await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "payments", { ...p, upiEnabled: true, upiVpa: "omenterprise@okaxis", upiPayeeName: "OM ENTERPRISE", gatewayProvider: "none" }));
  itemA = await publishedItem("600");
  itemB = await publishedItem("400");
});

describe("website customer accounts", () => {
  it("signs up with a mobile number, signs in, and refuses a wrong password or a second account", async () => {
    const m = mobile();
    const up = await shopSignUp({ name: "  Kalpesh   Shah ", mobile: m, password: "kalpesh-123" }, client);
    expect(up.account).toMatchObject({ name: "Kalpesh Shah", mobile: m });
    expect(await shopAccountFromToken(up.token)).toMatchObject({ mobile: m });
    expect((await rejects(shopSignUp({ name: "Other", mobile: m, password: "another-123" }, client))).code).toBe("CONFLICT");
    expect((await rejects(shopSignIn({ mobile: m, password: "wrong-pass" }, client))).message).toBe("Wrong mobile number or password");
    expect((await shopSignIn({ mobile: `+91 ${m}`, password: "kalpesh-123" }, client)).account.mobile).toBe(m);
    expect((await rejects(shopSignUp({ name: "Short", mobile: mobile(), password: "short" }, client))).code).toBe("VALIDATION");
  });
});

describe("discount codes", () => {
  it("generates single-use codes and accepts them typed loosely", async () => {
    const codes = await batch({ count: 5 });
    expect(codes).toHaveLength(5);
    expect(new Set(codes).size).toBe(5);
    for (const c of codes) expect(c).toMatch(/^OM-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeCouponCode(` ${codes[0].toLowerCase().replace(/-/g, " ")} `)).toBe(codes[0]);
  });

  it("refuses a minimum order that isn't above the amount off", async () => {
    expect((await rejects(generateCoupons(admin, { label: "Bad", amountOff: "100", minOrder: "100", count: 1, validUntil: null }))).code).toBe("VALIDATION");
    expect((await rejects(generateCoupons(sachin, { label: "No", amountOff: "100", minOrder: "0", count: 1, validUntil: null }))).code).toBe("FORBIDDEN");
  });

  it("checks the minimum order and the end date at checkout", async () => {
    const a = await customer();
    const [needs2000] = await batch({ minOrder: "2000", count: 1 });
    expect((await rejects(previewCheckout(a, { items: cart(), couponCode: needs2000 }, client))).message).toContain("₹2,000");
    const [ok] = await batch({ count: 1 });
    const p = await previewCheckout(a, { items: cart(), couponCode: ok }, client);
    expect(p).toMatchObject({ subtotal: "1000.00", discount: "100.00", total: "900.00", coupon: { code: ok } });
    expect((await rejects(previewCheckout(a, { items: cart(), couponCode: "OM-AAAA-AAAA" }, client))).message).toContain("isn't valid");
  });
});

describe("online order: ₹1,000 cart, ₹100 code, UPI, UTR, shop verifies", () => {
  it("runs end to end and logs every step", async () => {
    const a = await customer();
    const [code] = await batch({ count: 1 });
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code.toLowerCase() }, client);
    expect(orderNumber).toMatch(/^OL\d{6}$/);

    const placed = await getMyOrder(a, orderNumber);
    expect(placed.order).toMatchObject({ status: "awaiting_payment", subtotal: "1000.00", discount: "100.00", total: "900.00", couponCode: code });
    // The QR asks for exactly the amount to pay, to the shop's UPI ID.
    expect(placed.order.qrPayload).toContain("am=900.00");
    expect(placed.order.qrPayload).toContain("pa=omenterprise%40okaxis");
    expect(placed.order.qrPayload).toContain(orderNumber);
    expect(placed.lines).toHaveLength(2);

    // The code is held for this order and can't be used on another.
    const other = await customer();
    expect((await rejects(placeOnlineOrder(other, { items: cart(), couponCode: code }, client))).message).toContain("already on another order");

    expect((await rejects(submitUtr(a, orderNumber, "12345", client))).code).toBe("VALIDATION");
    const ref = utr();
    expect(await submitUtr(a, orderNumber, ` ${ref} `, client)).toEqual({ status: "payment_submitted" });
    expect((await rejects(submitUtr(a, orderNumber, utr(), client))).code).toBe("CONFLICT");

    // Counter staff with payments.verify confirm the credit in the bank app.
    await verifyOnlinePayment(sachin, (await idOf(orderNumber)), { note: "Seen in PhonePe Business" });
    expect((await getMyOrder(a, orderNumber)).order).toMatchObject({ status: "paid", utr: ref });
    const [c] = await getDb().select().from(coupons).where(eq(coupons.code, code));
    expect(c.status).toBe("used");

    await setOnlineOrderStatus(sachin, await idOf(orderNumber), { status: "ready" });
    await setOnlineOrderStatus(sachin, await idOf(orderNumber), { status: "collected" });
    expect((await getMyOrder(a, orderNumber)).order.status).toBe("collected");

    const trail = await getDb().select({ action: auditLogs.action }).from(auditLogs).where(eq(auditLogs.entityId, await idOf(orderNumber)));
    expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(["online_order.place", "online_order.utr_submitted", "online_order.payment_verified", "online_order.ready", "online_order.collected"]));
  });

  it("refuses a UTR already used on another order", async () => {
    const ref = utr();
    const a = await customer();
    const first = await placeOnlineOrder(a, { items: cart() }, client);
    await submitUtr(a, first.orderNumber, ref, client);
    const b = await customer();
    const second = await placeOnlineOrder(b, { items: cart() }, client);
    expect((await rejects(submitUtr(b, second.orderNumber, ref, client))).message).toContain("already been used");
  });

  it("frees the code when the payment isn't found, so it can be used again", async () => {
    const a = await customer();
    const [code] = await batch({ count: 1 });
    const { orderNumber } = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    await submitUtr(a, orderNumber, utr(), client);
    expect((await rejects(failOnlinePayment(admin, await idOf(orderNumber), { reason: "" }))).code).toBe("VALIDATION");
    await failOnlinePayment(admin, await idOf(orderNumber), { reason: "No credit with this UTR in the bank app" });
    expect((await getMyOrder(a, orderNumber)).order).toMatchObject({ status: "payment_failed", failureReason: "No credit with this UTR in the bank app" });
    const again = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    expect((await getMyOrder(a, again.orderNumber)).order.total).toBe("900.00");
  });

  it("frees the code when the customer cancels or the time to pay runs out", async () => {
    const a = await customer();
    const [code] = await batch({ count: 1 });
    const first = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    await cancelMyOrder(a, first.orderNumber, client);
    const second = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    await getDb().update(onlineOrders).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(onlineOrders.orderNumber, second.orderNumber));
    expect((await getMyOrder(a, second.orderNumber)).order.status).toBe("expired");
    expect((await rejects(submitUtr(a, second.orderNumber, utr(), client))).message).toContain("expired");
    const third = await placeOnlineOrder(a, { items: cart(), couponCode: code }, client);
    expect((await getMyOrder(a, third.orderNumber)).order.couponCode).toBe(code);
  });

  it("won't use a disabled code, and a customer can't see someone else's order", async () => {
    const a = await customer();
    const [code] = await batch({ count: 1 });
    const { batchId } = { batchId: (await getDb().select({ b: coupons.batchId }).from(coupons).where(eq(coupons.code, code)))[0].b };
    await disableCoupons(admin, { batchId });
    expect((await rejects(placeOnlineOrder(a, { items: cart(), couponCode: code }, client))).message).toContain("isn't valid");
    const mine = await placeOnlineOrder(a, { items: cart() }, client);
    const stranger = await customer();
    expect((await rejects(getMyOrder(stranger, mine.orderNumber))).code).toBe("NOT_FOUND");
  });
});

async function idOf(orderNumber: string) {
  const [o] = await getDb().select({ id: onlineOrders.id }).from(onlineOrders).where(eq(onlineOrders.orderNumber, orderNumber));
  return o.id;
}
