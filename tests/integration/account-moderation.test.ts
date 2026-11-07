import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLogs, onlineOrders, shopAccounts, shopBlocklist, shopDeletionRequests } from "@/server/db/schema";
import type { Actor } from "@/server/auth/actor";
import { shopAccountFromToken, shopSignIn, shopSignUp, verifyAccountEmail } from "@/server/services/shop-auth";
import { sendEmailCode } from "@/server/services/shop-otp";
import { updateMyProfile } from "@/server/services/shop-profile";
import { getShopCustomer, listShopCustomers, setShopCustomerActive, shopCustomerStats } from "@/server/services/shop-customers";
import {
  addToBlocklist,
  banShopCustomer,
  deleteShopAccount,
  listBlocklist,
  listDeletionRequests,
  maskMobile,
  rejectDeletionRequest,
  removeFromBlocklist,
  requestAccountDeletion,
  unbanShopCustomer,
  withdrawDeletionRequest,
} from "@/server/services/shop-moderation";
import { deletePhrase } from "@/lib/delete-phrase";
import { client, makeUser, rejects, setRegistration, uid } from "./helpers";

let owner: Actor;
let manager: Actor; // the Admin role
let sales: Actor;
let seq = 0;

const mobile = () => `7${String(Date.now() % 1_000_000_000).padStart(9, "0").slice(-6)}${String(seq++ % 1000).padStart(3, "0")}`;
const ip = () => ({ ...client, ip: `10.11.${seq % 250}.${seq++ % 250}` });

async function customer(name = "Nita Shah", email: string | null = null) {
  const m = mobile();
  const up = await shopSignUp({ name, mobile: m, password: "nita-12345", email }, ip());
  return { account: up.account, token: up.token, mobile: m };
}
const signIn = (m: string, password = "nita-12345") => shopSignIn({ mobile: m, password }, ip());
async function order(accountId: string, status: "awaiting_payment" | "paid" | "collected", m: string) {
  const [o] = await getDb()
    .insert(onlineOrders)
    .values({
      orderNumber: `OL8${String(Date.now()).slice(-6)}${seq++}`,
      accountId,
      customerName: "Nita Shah",
      mobile: m,
      subtotal: "500",
      discount: "0",
      total: "500",
      paymentMethod: "razorpay",
      status,
      verifiedAt: status === "awaiting_payment" ? null : new Date(),
      gatewayTransactionId: status === "awaiting_payment" ? null : `pay_${uid("M")}`,
      gatewayAttempt: 1,
      gatewayMerchantOrderId: `OL8-${uid("r")}`,
      expiresAt: new Date(Date.now() + 3600_000),
    })
    .returning();
  return o;
}

beforeAll(async () => {
  await setRegistration("regular");
  owner = await makeUser("super_admin");
  manager = await makeUser("admin");
  sales = await makeUser("sales");
});

describe("freeze", () => {
  it("puts an account on hold: signed out, told only after the right password, back on when unfrozen", async () => {
    const c = await customer();
    await setShopCustomerActive(sales, c.account.id, { active: false, reason: "Payment dispute" });
    expect(await shopAccountFromToken(c.token)).toBeNull();
    expect((await rejects(signIn(c.mobile, "wrong-pass"))).message).toBe("Wrong mobile number or password");
    const held = await rejects(signIn(c.mobile));
    expect(held.code).toBe("FORBIDDEN");
    expect(held.message).toContain("on hold");
    expect((await getShopCustomer(sales, c.account.id)).customer).toMatchObject({ status: "frozen", statusReason: "Payment dispute", isActive: false });
    await setShopCustomerActive(sales, c.account.id, { active: true });
    expect((await signIn(c.mobile)).account.id).toBe(c.account.id);
  });
});

describe("ban and the blocklist", () => {
  it("bans for fraud: only with the permission; blocks the mobile and email; every later try is refused and counted", async () => {
    const email = `${uid("fraud")}@example.test`;
    const c = await customer("Fraud Test", email);
    const unpaid = await order(c.account.id, "awaiting_payment", c.mobile);
    expect((await rejects(banShopCustomer(sales, c.account.id, { reason: "Fake UPI screenshots" }))).code).toBe("FORBIDDEN");
    expect((await rejects(banShopCustomer(manager, c.account.id, { reason: "x" }))).code).toBe("VALIDATION");

    const r = await banShopCustomer(manager, c.account.id, { reason: "Fake UPI screenshots" });
    expect(r.blocked.sort()).toEqual([`email ${email}`, `mobile ${c.mobile}`].sort());
    expect(r.closedOrders).toBe(1);
    const [closed] = await getDb().select().from(onlineOrders).where(eq(onlineOrders.id, unpaid.id));
    expect(closed.status).toBe("cancelled");
    expect(await shopAccountFromToken(c.token)).toBeNull();
    expect((await rejects(banShopCustomer(manager, c.account.id, { reason: "again" }))).code).toBe("CONFLICT");
    // Can't be unfrozen around the ban.
    expect((await rejects(setShopCustomerActive(sales, c.account.id, { active: true }))).code).toBe("CONFLICT");

    // Sign in: refused (with the right password the reason is shown); sign up again: refused; email code: refused.
    expect((await rejects(signIn(c.mobile))).message).toContain("can't be used");
    expect((await rejects(shopSignUp({ name: "New Name", mobile: c.mobile, password: "another-123" }, ip()))).code).toBe("FORBIDDEN");
    expect((await rejects(shopSignUp({ name: "New Name", mobile: mobile(), password: "another-123", email: email.toUpperCase() }, ip()))).code).toBe("FORBIDDEN");
    expect((await rejects(sendEmailCode({ email, purpose: "sign_up" }, ip()))).code).toBe("FORBIDDEN");
    const [b] = await getDb().select().from(shopBlocklist).where(and(eq(shopBlocklist.kind, "mobile"), eq(shopBlocklist.value, c.mobile)));
    expect(b.hits).toBeGreaterThanOrEqual(2);
    expect((await getDb().select().from(auditLogs).where(eq(auditLogs.action, "shop.blocked_attempt"))).length).toBeGreaterThan(0);
    expect((await listShopCustomers(sales, { filter: "banned", q: c.mobile })).items.map((x) => x.id)).toEqual([c.account.id]);
    expect((await getShopCustomer(sales, c.account.id)).blocks.length).toBe(2);

    // Lifting the ban (and the blocks made with it) lets them back in.
    await unbanShopCustomer(manager, c.account.id, { reason: "Bank confirmed the payments", unblock: true });
    expect((await signIn(c.mobile)).account.id).toBe(c.account.id);
    expect((await listBlocklist(owner, { q: c.mobile })).length).toBe(0);
    expect((await listBlocklist(owner, { q: c.mobile, show: "removed" })).length).toBe(1);
  });

  it("blocks a number on its own: any account using it is banned; it can't be added to a profile; unblocking frees it", async () => {
    const c = await customer();
    const spare = mobile();
    expect((await rejects(addToBlocklist(sales, { kind: "mobile", value: spare, reason: "Called with a fake payment" }))).code).toBe("FORBIDDEN");
    expect((await rejects(addToBlocklist(owner, { kind: "mobile", value: "12345", reason: "bad" }))).code).toBe("VALIDATION");

    const res = await addToBlocklist(owner, { kind: "mobile", value: `+91 ${c.mobile.slice(0, 5)} ${c.mobile.slice(5)}`, reason: "Called with a fake payment" });
    expect(res).toEqual({ value: c.mobile, bannedAccounts: 1 });
    expect((await rejects(addToBlocklist(owner, { kind: "mobile", value: c.mobile, reason: "again" }))).code).toBe("CONFLICT");
    expect(await shopAccountFromToken(c.token)).toBeNull();
    expect((await getShopCustomer(sales, c.account.id)).customer.status).toBe("banned");

    // A blocked number can't be someone's other phone either.
    const other = await customer();
    await addToBlocklist(owner, { kind: "mobile", value: spare, reason: "Known fraud number" });
    const err = await rejects(updateMyProfile(other.account, { name: "Nita Shah", altMobile: spare }, ip()));
    expect((err as { details?: { field?: string } }).details?.field).toBe("altMobile");

    const [entry] = await listBlocklist(owner, { q: spare });
    expect((await rejects(removeFromBlocklist(owner, entry.b.id, { reason: "" }))).code).toBe("VALIDATION");
    await removeFromBlocklist(owner, entry.b.id, { reason: "Number reassigned" });
    expect((await shopSignUp({ name: "Fresh", mobile: spare, password: "fresh-12345" }, ip())).account.mobile).toBe(spare);
  });

  it("refuses to verify a blocked email onto an account", async () => {
    const c = await customer();
    const email = `${uid("blk")}@example.test`;
    await addToBlocklist(owner, { kind: "email", value: email, reason: "Fraud address" });
    expect((await rejects(verifyAccountEmail(c.account, { email, code: "123456" }, ip()))).code).toBe("FORBIDDEN");
  });
});

describe("deleting accounts", () => {
  it("customer asks (password checked, once at a time, can withdraw); staff see it; it waits while money is held", async () => {
    const c = await customer("Leaving Customer", `${uid("leave")}@example.test`);
    expect((await rejects(requestAccountDeletion(c.account, { password: "wrong-pass" }, ip()))).code).toBe("VALIDATION");
    await requestAccountDeletion(c.account, { password: "nita-12345", reason: "Moving away" }, ip());
    expect((await rejects(requestAccountDeletion(c.account, { password: "nita-12345" }, ip()))).code).toBe("CONFLICT");
    await withdrawDeletionRequest(c.account, ip());
    expect((await rejects(withdrawDeletionRequest(c.account, ip()))).code).toBe("CONFLICT");
    await requestAccountDeletion(c.account, { password: "nita-12345", reason: "Moving away" }, ip());

    const pending = await listDeletionRequests(sales, { q: c.mobile });
    expect(pending.map((p) => p.r.reason)).toEqual(["Moving away"]);
    expect((await getShopCustomer(sales, c.account.id)).deletionRequest?.reason).toBe("Moving away");

    const paid = await order(c.account.id, "paid", c.mobile);
    const unpaid = await order(c.account.id, "awaiting_payment", c.mobile);
    const phrase = deletePhrase(manager.username);
    expect((await rejects(deleteShopAccount(sales, c.account.id, { confirm: deletePhrase(sales.username) }))).code).toBe("FORBIDDEN");
    expect((await rejects(deleteShopAccount(manager, c.account.id, { confirm: "nope" }))).code).toBe("VALIDATION");
    const blocked = await rejects(deleteShopAccount(manager, c.account.id, { confirm: phrase }));
    expect(blocked.code).toBe("CONFLICT");
    expect(blocked.message).toContain(paid.orderNumber);

    await getDb().update(onlineOrders).set({ status: "collected", collectedAt: new Date() }).where(eq(onlineOrders.id, paid.id));
    const before = await shopCustomerStats(sales);
    const done = await deleteShopAccount(manager, c.account.id, { confirm: phrase, requestId: pending[0].r.id });
    expect(done.completedRequest).toBe(true);

    // The person's details are gone; they can't sign in; the mobile is free to sign up again.
    const [a] = await getDb().select().from(shopAccounts).where(eq(shopAccounts.id, c.account.id));
    expect(a).toMatchObject({ name: "Deleted customer", email: null, status: "deleted", isActive: false, addressLine1: null });
    expect(a.mobile).not.toContain(c.mobile);
    expect(JSON.stringify(a)).not.toContain("Leaving Customer");
    expect(await shopAccountFromToken(c.token)).toBeNull();
    expect((await rejects(signIn(c.mobile))).message).toBe("Wrong mobile number or password");
    expect((await customer("Came Back")).account.id).not.toBe(c.account.id);

    // The request is done and keeps only a masked trace; the paid order stays as the sales record.
    const [req] = await getDb().select().from(shopDeletionRequests).where(eq(shopDeletionRequests.accountId, c.account.id)).orderBy(shopDeletionRequests.requestedAt);
    const all = await getDb().select().from(shopDeletionRequests).where(eq(shopDeletionRequests.accountId, c.account.id));
    expect(all.find((x) => x.status === "completed")).toMatchObject({ name: "Deleted customer", mobile: maskMobile(c.mobile), decidedBy: manager.id });
    expect(JSON.stringify(all)).not.toContain(c.mobile);
    expect(req).toBeTruthy();
    const kept = await getDb().select().from(onlineOrders).where(eq(onlineOrders.accountId, c.account.id));
    expect(kept.find((o) => o.id === paid.id)?.status).toBe("collected");
    expect(kept.find((o) => o.id === unpaid.id)?.status).toBe("cancelled");
    expect((await listShopCustomers(sales, { q: "Deleted customer" })).items.map((x) => x.id)).not.toContain(c.account.id);
    expect((await listShopCustomers(sales, { filter: "deleted" })).items.map((x) => x.id)).toContain(c.account.id);
    expect((await shopCustomerStats(sales)).deleted).toBe(before.deleted + 1);
    expect((await rejects(deleteShopAccount(manager, c.account.id, { confirm: phrase }))).code).toBe("CONFLICT");
  });

  it("staff can delete and block for fraud, so the number never signs up again; or turn a request down", async () => {
    const c = await customer();
    await deleteShopAccount(owner, c.account.id, { confirm: deletePhrase(owner.username), reason: "Fraud", block: true });
    expect((await rejects(shopSignUp({ name: "Again", mobile: c.mobile, password: "again-12345" }, ip()))).code).toBe("FORBIDDEN");

    const d = await customer();
    await requestAccountDeletion(d.account, { password: "nita-12345" }, ip());
    const [p] = await listDeletionRequests(sales, { q: d.mobile });
    expect((await rejects(rejectDeletionRequest(manager, p.r.id, { note: "" }))).code).toBe("VALIDATION");
    await rejectDeletionRequest(manager, p.r.id, { note: "Request didn't come from the customer" });
    expect((await rejects(rejectDeletionRequest(manager, p.r.id, { note: "again" }))).code).toBe("CONFLICT");
    expect((await signIn(d.mobile)).account.id).toBe(d.account.id);
    expect((await listDeletionRequests(sales, { status: "rejected", q: d.mobile }))[0].r.decisionNote).toBe("Request didn't come from the customer");
  });
});
