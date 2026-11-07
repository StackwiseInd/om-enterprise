import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { onlineOrders, shopAccounts } from "@/server/db/schema";
import type { Actor } from "@/server/auth/actor";
import { shopAccountFromToken, shopSignIn, shopSignUp } from "@/server/services/shop-auth";
import { getShopCustomer, latestShopCustomers, listShopCustomers, resetShopCustomerPassword, setShopCustomerActive, shopCustomerStats } from "@/server/services/shop-customers";
import { client, makeUser, rejects, setRegistration, uid } from "./helpers";

let admin: Actor;
let sales: Actor;
let accountant: Actor;
let seq = 0;

const mobile = () => `9${String(Date.now() % 1_000_000_000).padStart(9, "0").slice(-7)}${String(seq++ % 100).padStart(2, "0")}`;
const ip = () => ({ ...client, ip: `10.6.${seq % 250}.${seq++ % 250}` });

async function signUp(name: string, opts: { email?: string; verified?: boolean } = {}) {
  const m = mobile();
  const r = await shopSignUp({ name, mobile: m, password: "first-pass-123", email: opts.email ?? null }, ip());
  if (opts.verified && opts.email) await getDb().update(shopAccounts).set({ emailVerifiedAt: new Date() }).where(eq(shopAccounts.id, r.account.id));
  return { ...r, mobile: m };
}
/** A paid online order for an account, written directly (the payment flow has its own tests). */
async function paidOrder(accountId: string, name: string, m: string, total: string) {
  await getDb().insert(onlineOrders).values({
    orderNumber: `OL9${String(Date.now()).slice(-6)}${seq++}`,
    accountId,
    customerName: name,
    mobile: m,
    subtotal: total,
    discount: "0",
    total,
    paymentMethod: "razorpay",
    status: "paid",
    verifiedAt: new Date(),
    gatewayTransactionId: `pay_${uid("T")}`,
    gatewayAttempt: 1,
    gatewayMerchantOrderId: `OL9${seq}-${Date.now()}`,
    expiresAt: new Date(Date.now() + 3600_000),
  });
}

beforeAll(async () => {
  await setRegistration("regular");
  admin = await makeUser("super_admin");
  sales = await makeUser("sales");
  accountant = await makeUser("accountant");
});

describe("staff view of website customers", () => {
  it("lists customers with their order figures and finds them by name, mobile or email", async () => {
    const tag = uid("zq");
    const a = await signUp(`Tara ${tag}`, { email: `tara.${tag}@example.test`, verified: true });
    const b = await signUp(`Bhavin ${tag}`);
    await paidOrder(a.account.id, a.account.name, a.mobile, "1200.00");
    await paidOrder(a.account.id, a.account.name, a.mobile, "300.50");

    const all = await listShopCustomers(sales, { q: tag });
    expect(all.total).toBe(2);
    const row = all.items.find((r) => r.id === a.account.id)!;
    expect(row).toMatchObject({ name: `Tara ${tag}`, mobile: a.mobile, email: `tara.${tag}@example.test`, isActive: true, orders: 2, paidOrders: 2, spent: "1500.50" });
    expect(row.emailVerifiedAt).toBeInstanceOf(Date);
    expect(all.items.find((r) => r.id === b.account.id)).toMatchObject({ orders: 0, paidOrders: 0, spent: "0", emailVerifiedAt: null, lastOrderAt: null });
    // Newest first.
    expect(all.items[0].id).toBe(b.account.id);

    expect((await listShopCustomers(sales, { q: a.mobile.slice(2, 8) })).items.map((r) => r.id)).toContain(a.account.id);
    expect((await listShopCustomers(sales, { q: ` ${a.mobile.slice(0, 5)} ${a.mobile.slice(5)} ` })).items.map((r) => r.id)).toContain(a.account.id);
    expect((await listShopCustomers(sales, { q: `TARA.${tag}@EXAMPLE` })).items.map((r) => r.id)).toEqual([a.account.id]);
    expect((await listShopCustomers(sales, { q: "%" })).items.every((r) => /[%]/.test(r.name + r.email) || false)).toBe(true); // wildcards are plain text

    const ids = async (filter: Parameters<typeof listShopCustomers>[1] extends infer O ? (O extends { filter?: infer F } ? F : never) : never) => (await listShopCustomers(sales, { q: tag, filter })).items.map((r) => r.id);
    expect(await ids("verified")).toEqual([a.account.id]);
    expect(await ids("unverified")).toEqual([b.account.id]);
    expect(await ids("buyers")).toEqual([a.account.id]);
    expect(await ids("disabled")).toEqual([]);
  });

  it("totals the customers for the page and the dashboard card", async () => {
    const before = await shopCustomerStats(sales);
    const c = await signUp(`Stats ${uid("s")}`);
    await paidOrder(c.account.id, c.account.name, c.mobile, "250.00");
    const after = await shopCustomerStats(sales);
    expect(after.total).toBe(before.total + 1);
    expect(after.newThisWeek).toBe(before.newThisWeek + 1);
    expect(after.buyers).toBe(before.buyers + 1);
    expect(Number(after.spent) - Number(before.spent)).toBeCloseTo(250, 2);
    const latest = await latestShopCustomers(sales, 3);
    expect(latest[0].id).toBe(c.account.id);
    expect(latest.length).toBeLessThanOrEqual(3);
  });

  it("shows one customer's account, orders and history, and never the password", async () => {
    const tag = uid("d");
    const c = await signUp(`Detail ${tag}`, { email: `d.${tag}@example.test` });
    await paidOrder(c.account.id, c.account.name, c.mobile, "800.00");
    const d = await getShopCustomer(sales, c.account.id);
    expect(d.customer).toMatchObject({ name: `Detail ${tag}`, mobile: c.mobile, email: `d.${tag}@example.test`, isActive: true });
    expect(d.stats).toMatchObject({ orders: 1, paidOrders: 1, spent: "800.00", collected: 0 });
    expect(d.orders).toHaveLength(1);
    expect(d.history.some((h) => h.action === "shop.signup")).toBe(true);
    const everything = JSON.stringify(d);
    expect(everything).not.toMatch(/passwordHash|password_hash|\$argon2|scrypt/i);
    expect(Object.keys(d.customer)).not.toContain("passwordHash");
    expect((await rejects(getShopCustomer(sales, "00000000-0000-4000-8000-000000000000"))).code).toBe("NOT_FOUND");
  });

  it("disables an account: signed out, can't sign in, back on when re-enabled", async () => {
    const c = await signUp(`Disable ${uid("x")}`);
    expect((await rejects(setShopCustomerActive(accountant, c.account.id, { active: false, reason: "test" }))).code).toBe("FORBIDDEN");
    expect((await rejects(setShopCustomerActive(sales, c.account.id, { active: false }))).code).toBe("VALIDATION");
    expect(await shopAccountFromToken(c.token)).not.toBeNull();

    await setShopCustomerActive(sales, c.account.id, { active: false, reason: "Chargeback dispute" });
    expect(await shopAccountFromToken(c.token)).toBeNull(); // signed out everywhere
    expect((await rejects(shopSignIn({ mobile: c.mobile, password: "first-pass-123" }, ip()))).message).toContain("on hold");
    expect((await listShopCustomers(sales, { filter: "disabled", q: c.mobile })).items.map((r) => r.id)).toEqual([c.account.id]);
    expect((await listShopCustomers(sales, { filter: "frozen", q: c.mobile })).items.map((r) => r.id)).toEqual([c.account.id]);
    expect((await rejects(setShopCustomerActive(sales, c.account.id, { active: false, reason: "again" }))).code).toBe("CONFLICT");

    await setShopCustomerActive(admin, c.account.id, { active: true });
    expect((await shopSignIn({ mobile: c.mobile, password: "first-pass-123" }, ip())).account.id).toBe(c.account.id);
    const h = (await getShopCustomer(sales, c.account.id)).history.map((x) => x.summary).join("\n");
    expect(h).toContain("frozen by staff: Chargeback dispute");
    expect(h).toContain("unfrozen by staff");
  });

  it("sets a new password for a customer who asked: old one stops working, signed out everywhere, nothing readable is stored", async () => {
    const c = await signUp(`Reset ${uid("r")}`);
    expect((await rejects(resetShopCustomerPassword(accountant, c.account.id, "brand-new-pass"))).code).toBe("FORBIDDEN");
    expect((await rejects(resetShopCustomerPassword(sales, c.account.id, "short"))).code).toBe("VALIDATION");
    // Lock the account with wrong passwords, as a customer who has forgotten theirs would.
    for (let i = 0; i < 8; i++) await rejects(shopSignIn({ mobile: c.mobile, password: "wrong-pass" }, ip()));
    expect((await rejects(shopSignIn({ mobile: c.mobile, password: "first-pass-123" }, ip()))).code).toBe("RATE_LIMITED");

    await resetShopCustomerPassword(sales, c.account.id, "Brand-new-pw-77");
    expect(await shopAccountFromToken(c.token)).toBeNull();
    expect((await rejects(shopSignIn({ mobile: c.mobile, password: "first-pass-123" }, ip()))).message).toBe("Wrong mobile number or password");
    expect((await shopSignIn({ mobile: c.mobile, password: "Brand-new-pw-77" }, ip())).account.id).toBe(c.account.id); // lock cleared too

    const [row] = await getDb().select({ hash: shopAccounts.passwordHash }).from(shopAccounts).where(eq(shopAccounts.id, c.account.id));
    expect(row.hash).not.toContain("Brand-new-pw-77");
    const audit = await getDb().execute<{ blob: string }>(sql`select string_agg(summary || coalesce(data::text, ''), ' ') as blob from audit_logs where entity_id = ${c.account.id}`);
    expect(audit.rows[0].blob).not.toContain("Brand-new-pw-77");
    expect(audit.rows[0].blob).toContain("New password set");
    expect((await rejects(resetShopCustomerPassword(sales, "00000000-0000-4000-8000-000000000000", "Brand-new-pw-77"))).code).toBe("NOT_FOUND");
  });
});
