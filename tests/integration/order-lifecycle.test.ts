import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { onlineOrders, shopSessions } from "@/server/db/schema";
import { getSettings, saveSettings } from "@/server/settings";
import type { Actor } from "@/server/auth/actor";
import { createProduct, createVariant, setProductPublished, setProductReview } from "@/server/services/catalog";
import { proposePrice } from "@/server/services/pricing";
import { customerAuditActor, shopAccountFromToken, shopSignIn, shopSignUp, type ShopAccount } from "@/server/services/shop-auth";
import { changeMyPassword, getMyProfile, updateMyProfile } from "@/server/services/shop-profile";
import { cancelMyOrder, deleteOnlineOrder, getMyOrder, getOnlineOrder, listMyOrders, listOnlineOrders, payMyOrder, placeOnlineOrder, setOnlineOrderStatus } from "@/server/services/online-orders";
import { getPaymentReceipt, getPaymentReceiptForStaff } from "@/server/services/online-receipt";
import { renderPaymentReceiptPdf } from "@/server/pdf/payment-receipt";
import { __setRazorpayClientForTests, refundOnlineOrder, verifyCheckoutPayment } from "@/server/services/online-payments";
import { getShopCustomer, shopCustomerStats } from "@/server/services/shop-customers";
import { queryOnlineOrderLog } from "@/server/services/online-order-log";
import { deletePhrase } from "@/lib/delete-phrase";
import { RazorpayClient, razorpayConfigFromEnv } from "@/server/payments/razorpay";
import { FakeRazorpay } from "../support/fake-razorpay";
import { gstinCheckChar } from "@/lib/india";
import { client, firstCategoryId, makeUser, rejects, setRegistration, taxClassId } from "./helpers";

let admin: Actor;
let sachin: Actor;
let accountant: Actor;
let item: string; // ₹750
let fake: FakeRazorpay;
let seq = 0;

const mobile = () => `6${String(Date.now() % 1_000_000_000).padStart(9, "0").slice(-7)}${String(seq++ % 100).padStart(2, "0")}`;
const ip = () => ({ ...client, ip: `10.9.${seq % 250}.${seq++ % 250}` });

async function customer(name = "Ravi Patel") {
  const m = mobile();
  const up = await shopSignUp({ name, mobile: m, password: "ravi-12345" }, ip());
  return { account: up.account, token: up.token, mobile: m };
}
/** Which form field the error points at. */
const fieldOf = async (p: Promise<unknown>) => ((await rejects(p)) as { details?: { field?: string } }).details?.field;
async function row(orderNumber: string) {
  const [o] = await getDb().select().from(onlineOrders).where(eq(onlineOrders.orderNumber, orderNumber));
  return o;
}
/** Place an order and pay it on (fake) Razorpay. */
async function paidOrder(a: ShopAccount) {
  const { orderNumber } = await placeOnlineOrder(a, { items: [{ variantId: item, quantity: "1" }] }, ip());
  const { checkout } = await payMyOrder(a, orderNumber, ip());
  const p = fake.pay(checkout.orderId, { method: "upi" });
  const r = await verifyCheckoutPayment(a.id, orderNumber, { orderId: checkout.orderId, paymentId: p.id, signature: fake.signCheckout(checkout.orderId, p.id) }, customerAuditActor(a, client));
  expect(r.status).toBe("paid");
  return { orderNumber, id: (await row(orderNumber)).id, paymentId: p.id };
}

beforeAll(async () => {
  process.env.RAZORPAY_KEY_ID = "rzp_test_FAKEKEY123";
  process.env.RAZORPAY_KEY_SECRET = "fake-secret-0123456789";
  await setRegistration("regular");
  const website = await getSettings("website");
  await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "website", { ...website, requireEmailVerification: false }));
  admin = await makeUser("super_admin");
  sachin = await makeUser("sales");
  accountant = await makeUser("accountant");
  const name = `Lifecycle ${Date.now().toString(36)}`;
  const p = await createProduct(admin, { name, categoryId: await firstCategoryId(), unitCode: "pcs", taxClassId: await taxClassId("18"), hsnCode: "3917" });
  const v = await createVariant(admin, p.id, { sku: `SKU-${name.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`, name: "Std", unitCode: "pcs" });
  await proposePrice(admin, { variantId: v.id, price: "750", priceIncludesTax: true, reason: "test price" });
  await setProductReview(admin, p.id, "approved");
  await setProductPublished(admin, p.id, true);
  item = v.id;
});
beforeEach(() => {
  fake = new FakeRazorpay();
  __setRazorpayClientForTests(new RazorpayClient(razorpayConfigFromEnv()!, fake.fetchFor()));
});
afterAll(async () => {
  __setRazorpayClientForTests(null);
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  const website = await getSettings("website");
  await getDb().transaction((tx) => saveSettings(tx, { userId: null, label: "test" }, "website", { ...website, requireEmailVerification: true }));
});

describe("My profile", () => {
  it("keeps the address, business and GSTIN, checks them, and records each change", async () => {
    const { account: a } = await customer();
    expect(await fieldOf(updateMyProfile(a, { name: "Ravi Patel", gstin: "24ABCDE1234F1Z9" }, ip()))).toBe("gstin");
    expect(await fieldOf(updateMyProfile(a, { name: "Ravi Patel", pincode: "39644" }, ip()))).toBe("pincode");
    expect(await fieldOf(updateMyProfile(a, { name: "Ravi Patel", altMobile: a.mobile }, ip()))).toBe("altMobile");
    expect(await fieldOf(updateMyProfile(a, { name: "Ravi Patel", city: "Navsari" }, ip()))).toBe("addressLine1");
    const gstin = `24AAACB1234C1Z${gstinCheckChar("24AAACB1234C1Z")}`;
    const p = await updateMyProfile(
      a,
      { name: "  Ravi   Patel ", businessName: "Patel Plumbing Works", gstin: gstin.toLowerCase(), altMobile: "+91 98250 12345", addressLine1: "12 Station Road", addressLine2: "Gandhi Nagar", landmark: "near the bus stand", city: "Navsari", state: "Gujarat", pincode: "396445" },
      ip(),
    );
    expect(p.gstin).toBe(gstin);
    expect(p).toMatchObject({ name: "Ravi Patel", businessName: "Patel Plumbing Works", altMobile: "9825012345", city: "Navsari", state: "Gujarat", pincode: "396445" });
    expect(p.profileUpdatedAt).toBeInstanceOf(Date);

    const staff = await getShopCustomer(sachin, a.id);
    expect(staff.customer).toMatchObject({ businessName: "Patel Plumbing Works", addressLine1: "12 Station Road", city: "Navsari", pincode: "396445" });
    expect(staff.history.some((h) => h.action === "shop.profile_updated" && /address/.test(h.summary))).toBe(true);
    expect(JSON.stringify(staff)).not.toMatch(/passwordHash|\$argon2|scrypt/i);
  });

  it("changes the password: the current one is needed, other devices are signed out, this one stays", async () => {
    const c = await customer();
    const other = await shopSignIn({ mobile: c.mobile, password: "ravi-12345" }, ip());
    expect(await fieldOf(changeMyPassword(c.account, { current: "wrong-pass", next: "ravi-new-123" }, c.token, ip()))).toBe("current");
    expect((await rejects(changeMyPassword(c.account, { current: "ravi-12345", next: "short" }, c.token, ip()))).code).toBe("VALIDATION");
    await changeMyPassword(c.account, { current: "ravi-12345", next: "ravi-new-123" }, c.token, ip());
    expect(await shopAccountFromToken(c.token)).not.toBeNull();
    expect(await shopAccountFromToken(other.token)).toBeNull();
    expect((await rejects(shopSignIn({ mobile: c.mobile, password: "ravi-12345" }, ip()))).code).toBe("UNAUTHENTICATED");
    expect((await shopSignIn({ mobile: c.mobile, password: "ravi-new-123" }, ip())).account.id).toBe(c.account.id);
    expect(await getDb().select().from(shopSessions).where(eq(shopSessions.accountId, c.account.id))).toHaveLength(2);
  });
});

describe("the order keeps the customer's details, and the receipt prints them", () => {
  it("snapshots name, email and address when the order is placed; later profile changes don't rewrite it", async () => {
    const { account: a } = await customer("Asha Desai");
    await updateMyProfile(a, { name: "Asha Desai", businessName: "Desai Traders", addressLine1: "4 Market Lane", city: "Bilimora", state: "Gujarat", pincode: "396321" }, ip());
    const { orderNumber, id } = await paidOrder(a);
    const staff = await getOnlineOrder(sachin, id);
    expect(staff.customerDetails).toMatchObject({ businessName: "Desai Traders", address: ["4 Market Lane", "Bilimora, Gujarat 396321"] });

    await updateMyProfile(a, { name: "Asha Desai", businessName: "Desai & Sons", addressLine1: "9 New Road", city: "Surat", state: "Gujarat", pincode: "395001" }, ip());
    const receipt = await getPaymentReceipt(a, orderNumber);
    expect(receipt.customer).toMatchObject({ name: "Asha Desai", mobile: a.mobile, businessName: "Desai Traders", address: ["4 Market Lane", "Bilimora, Gujarat 396321"] });
    expect(await getPaymentReceiptForStaff(sachin, id)).toMatchObject({ customer: receipt.customer });
    const pdf = await renderPaymentReceiptPdf(receipt);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});

describe("cancelling: the customer until the shop confirms, then only the shop", () => {
  it("lets the customer cancel a paid order and get the full amount back straight away", async () => {
    const { account: a } = await customer();
    const { orderNumber, paymentId } = await paidOrder(a);
    expect((await getMyOrder(a, orderNumber)).order).toMatchObject({ status: "paid", canCancel: true, confirmedAt: null });
    expect((await rejects(cancelMyOrder(a, orderNumber, ip(), { reason: "x" }))).code).toBe("VALIDATION");

    expect(await cancelMyOrder(a, orderNumber, ip(), { reason: "Changed my mind" })).toEqual({ status: "refunding" });
    const refund = fake.calls.find((c) => c.path === `/v1/payments/${paymentId}/refund`)!;
    expect(refund.body).toMatchObject({ amount: 75000 });
    expect(await row(orderNumber)).toMatchObject({ status: "refunding", refundState: "PENDING", cancelReason: "Cancelled by the customer: Changed my mind" });
    expect((await getMyOrder(a, orderNumber)).order.canCancel).toBe(false);
    // A second tap changes nothing.
    expect((await rejects(cancelMyOrder(a, orderNumber, ip(), { reason: "Changed my mind" }))).code).toBe("CONFLICT");
    const log = await queryOnlineOrderLog(admin, { q: orderNumber });
    expect(log.items.map((e) => e.action)).toEqual(expect.arrayContaining(["online_order.cancelled_by_customer", "online_order.refund_started", "online_order.payment_verified", "online_order.place"]));
  });

  it("locks the order once the shop confirms it; staff can still refund it", async () => {
    const { account: a } = await customer();
    const { orderNumber, id } = await paidOrder(a);
    expect((await rejects(setOnlineOrderStatus(accountant, id, { status: "confirmed" }))).code).toBe("FORBIDDEN");
    await setOnlineOrderStatus(sachin, id, { status: "confirmed" });
    expect(await row(orderNumber)).toMatchObject({ status: "confirmed", confirmedBy: sachin.id });
    expect((await getMyOrder(a, orderNumber)).order).toMatchObject({ status: "confirmed", canCancel: false });
    const err = await rejects(cancelMyOrder(a, orderNumber, ip(), { reason: "Changed my mind" }));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toContain("already confirmed");
    expect((await rejects(setOnlineOrderStatus(sachin, id, { status: "confirmed" }))).code).toBe("CONFLICT");
    // Still a paid order with a receipt.
    expect((await getPaymentReceipt(a, orderNumber)).status).toBe("confirmed");

    await refundOnlineOrder(admin, id, { reason: "Item out of stock" });
    expect((await row(orderNumber)).status).toBe("refunding");
  });

  it("ready and handed over count as confirmed, and the customer can't cancel those either", async () => {
    const { account: a } = await customer();
    const { orderNumber, id } = await paidOrder(a);
    await setOnlineOrderStatus(sachin, id, { status: "ready" });
    expect(await row(orderNumber)).toMatchObject({ status: "ready", confirmedBy: sachin.id });
    expect((await rejects(cancelMyOrder(a, orderNumber, ip(), { reason: "Changed my mind" }))).code).toBe("CONFLICT");
    await setOnlineOrderStatus(sachin, id, { status: "collected", reason: "Took everything" });
    expect((await rejects(cancelMyOrder(a, orderNumber, ip(), { reason: "Changed my mind" }))).code).toBe("CONFLICT");
  });

  it("still lets the customer cancel before paying, with no refund needed", async () => {
    const { account: a } = await customer();
    const { orderNumber } = await placeOnlineOrder(a, { items: [{ variantId: item, quantity: "1" }] }, ip());
    expect(await cancelMyOrder(a, orderNumber, ip(), {})).toEqual({ status: "cancelled" });
    expect(fake.calls.some((c) => c.path.includes("/refund"))).toBe(false);
  });
});

describe("deleting an online order (Super Admin)", () => {
  it("only the Super Admin, with the phrase; not while money is held; everywhere hidden; the log keeps it all", async () => {
    const { account: a } = await customer("Deleted Customer");
    const { orderNumber, id } = await paidOrder(a);
    const phrase = deletePhrase(admin.username);
    expect((await rejects(deleteOnlineOrder(sachin, id, { confirm: deletePhrase(sachin.username) }))).code).toBe("FORBIDDEN");
    expect((await rejects(deleteOnlineOrder(admin, id, { confirm: "nope" }))).code).toBe("VALIDATION");
    // Paid and not collected: refund or hand over first.
    expect((await rejects(deleteOnlineOrder(admin, id, { confirm: phrase }))).code).toBe("CONFLICT");

    await setOnlineOrderStatus(sachin, id, { status: "collected", reason: "All items taken" });
    const before = await shopCustomerStats(sachin);
    await deleteOnlineOrder(admin, id, { confirm: phrase, reason: "Duplicate test order" });
    expect((await rejects(deleteOnlineOrder(admin, id, { confirm: phrase }))).code).toBe("CONFLICT");

    expect(await row(orderNumber)).toMatchObject({ status: "collected", deletedBy: admin.id, deleteReason: "Duplicate test order" });
    expect((await listOnlineOrders(sachin, undefined, orderNumber)).length).toBe(0);
    expect((await rejects(getOnlineOrder(sachin, id))).code).toBe("NOT_FOUND");
    expect((await listMyOrders(a)).map((o) => o.orderNumber)).not.toContain(orderNumber);
    expect((await rejects(getMyOrder(a, orderNumber))).code).toBe("NOT_FOUND");
    expect((await rejects(getPaymentReceipt(a, orderNumber))).code).toBe("NOT_FOUND");
    const after = await shopCustomerStats(sachin);
    expect(Number(before.spent) - Number(after.spent)).toBeCloseTo(750, 2);
    expect((await getShopCustomer(sachin, a.id)).stats.orders).toBe(0);

    const log = await queryOnlineOrderLog(admin, { q: orderNumber });
    const del = log.items.find((e) => e.action === "online_order.deleted")!;
    expect(del.summary).toContain("Duplicate test order");
    expect(del.deletedAt).toBeInstanceOf(Date);
    const snap = del.data as { order: { orderNumber: string; total: string; collectNote: string; ipHash?: unknown }; lines: { productName: string }[] };
    expect(snap.order).toMatchObject({ orderNumber, total: "750.00", collectNote: "All items taken" });
    expect(snap.order.ipHash).toBeUndefined();
    expect(snap.lines).toHaveLength(1);
    expect(log.items.map((e) => e.action)).toEqual(expect.arrayContaining(["online_order.place", "online_order.payment_verified", "online_order.collected", "online_order.deleted"]));
    expect((await queryOnlineOrderLog(admin, { q: orderNumber, group: "deleted" })).items).toHaveLength(1);
    expect((await rejects(queryOnlineOrderLog(sachin, {}))).code).toBe("FORBIDDEN");
  });

  it("closes an order still waiting for payment before deleting it", async () => {
    const { account: a } = await customer();
    const { orderNumber, id } = await placeOnlineOrder(a, { items: [{ variantId: item, quantity: "1" }] }, ip()).then(async (r) => ({ ...r, id: (await row(r.orderNumber)).id }));
    await deleteOnlineOrder(admin, id, { confirm: deletePhrase(admin.username) });
    expect(await row(orderNumber)).toMatchObject({ status: "cancelled", cancelReason: "Deleted: Deleted by the Super Admin" });
    expect((await getMyProfile(a)).name).toBe("Ravi Patel");
  });
});
