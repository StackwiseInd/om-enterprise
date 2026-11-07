import "server-only";
import { and, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLogs, onlineOrders, shopAccounts, shopSessions } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { auditActorOf, requirePermission, type Actor } from "@/server/auth/actor";
import { conflict, invalid, notFound } from "@/server/errors";
import { hashPassword } from "@/server/auth/password";
import { SHOP_PASSWORD_MIN } from "@/server/services/shop-auth";
import { formatPhone } from "@/lib/india";

/**
 * Staff's view of the customers who signed up on the website. Passwords are never read here: they are stored
 * only as a one-way hash that nobody, staff included, can turn back into the password. Staff can disable an
 * account or set a new password for a customer who asks (the customer is signed out everywhere).
 */

export type CustomerFilter = "all" | "verified" | "unverified" | "disabled" | "buyers";
export const CUSTOMER_FILTERS: CustomerFilter[] = ["all", "verified", "unverified", "disabled", "buyers"];

// Per customer, from their online orders: how many, how many are paid, what they have spent, when they last ordered.
// Table names are written out (not column objects) because a single-table query leaves column names unqualified,
// which would make these correlated subqueries compare the wrong columns.
const PAID = sql.raw("('paid','ready','collected')");
const ordersCount = sql<number>`(select count(*)::int from online_orders o where o.account_id = shop_accounts.id)`;
const paidCount = sql<number>`(select count(*)::int from online_orders o where o.account_id = shop_accounts.id and o.status in ${PAID})`;
const spent = sql<string>`(select coalesce(sum(o.total), 0)::text from online_orders o where o.account_id = shop_accounts.id and o.status in ${PAID})`;
const lastOrderAt = sql<Date | null>`(select max(o.created_at) from online_orders o where o.account_id = shop_accounts.id)`;
const hasPaid = sql`exists (select 1 from online_orders o where o.account_id = shop_accounts.id and o.status in ${PAID})`;

function where(filter: CustomerFilter, q?: string): SQL | undefined {
  const conds: (SQL | undefined)[] = [];
  if (filter === "verified") conds.push(isNotNull(shopAccounts.emailVerifiedAt));
  if (filter === "unverified") conds.push(isNull(shopAccounts.emailVerifiedAt));
  if (filter === "disabled") conds.push(eq(shopAccounts.isActive, false));
  if (filter === "buyers") conds.push(hasPaid);
  const term = q?.trim().slice(0, 60);
  if (term) {
    const like = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    const digits = term.replace(/\D/g, "");
    conds.push(or(ilike(shopAccounts.name, like), ilike(shopAccounts.email, like), ilike(shopAccounts.mobile, digits.length >= 3 ? `%${digits}%` : like)));
  }
  const real = conds.filter((c): c is SQL => !!c);
  return real.length ? and(...real) : undefined;
}

export async function listShopCustomers(actor: Actor, opts: { q?: string; filter?: CustomerFilter; page?: number; pageSize?: number } = {}) {
  requirePermission(actor, "customers.view");
  const db = getDb();
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  const w = where(opts.filter ?? "all", opts.q);
  const items = await db
    .select({
      id: shopAccounts.id,
      name: shopAccounts.name,
      mobile: shopAccounts.mobile,
      email: shopAccounts.email,
      emailVerifiedAt: shopAccounts.emailVerifiedAt,
      isActive: shopAccounts.isActive,
      createdAt: shopAccounts.createdAt,
      lastLoginAt: shopAccounts.lastLoginAt,
      orders: ordersCount,
      paidOrders: paidCount,
      spent,
      lastOrderAt,
    })
    .from(shopAccounts)
    .where(w)
    .orderBy(desc(shopAccounts.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(shopAccounts).where(w);
  return { items, total };
}

/** The figures on top of the customers page and on the dashboard overview. */
export async function shopCustomerStats(actor: Actor) {
  requirePermission(actor, "customers.view");
  const [s] = await getDb()
    .select({
      total: sql<number>`count(*)::int`,
      verified: sql<number>`count(*) filter (where ${shopAccounts.emailVerifiedAt} is not null)::int`,
      disabled: sql<number>`count(*) filter (where ${shopAccounts.isActive} = false)::int`,
      newThisWeek: sql<number>`count(*) filter (where ${shopAccounts.createdAt} > now() - interval '7 days')::int`,
      buyers: sql<number>`count(*) filter (where ${hasPaid})::int`,
    })
    .from(shopAccounts);
  const [t] = await getDb().select({ spent: sql<string>`coalesce(sum(total), 0)::text` }).from(onlineOrders).where(sql`status in ${PAID}`);
  return { ...s, spent: t.spent };
}

/** The newest sign-ups, for the dashboard overview. */
export async function latestShopCustomers(actor: Actor, limit = 5) {
  requirePermission(actor, "customers.view");
  return getDb()
    .select({ id: shopAccounts.id, name: shopAccounts.name, mobile: shopAccounts.mobile, email: shopAccounts.email, emailVerifiedAt: shopAccounts.emailVerifiedAt, createdAt: shopAccounts.createdAt })
    .from(shopAccounts)
    .orderBy(desc(shopAccounts.createdAt))
    .limit(limit);
}

export async function getShopCustomer(actor: Actor, id: string) {
  requirePermission(actor, "customers.view");
  const db = getDb();
  // Named columns only: the password hash is never selected.
  const [customer] = await db
    .select({
      id: shopAccounts.id,
      name: shopAccounts.name,
      mobile: shopAccounts.mobile,
      email: shopAccounts.email,
      emailVerifiedAt: shopAccounts.emailVerifiedAt,
      isActive: shopAccounts.isActive,
      failedLoginCount: shopAccounts.failedLoginCount,
      lockedUntil: shopAccounts.lockedUntil,
      lastLoginAt: shopAccounts.lastLoginAt,
      createdAt: shopAccounts.createdAt,
    })
    .from(shopAccounts)
    .where(eq(shopAccounts.id, id));
  if (!customer) throw notFound("Customer");
  const orders = await db
    .select({
      id: onlineOrders.id,
      orderNumber: onlineOrders.orderNumber,
      status: onlineOrders.status,
      total: onlineOrders.total,
      paymentMethod: onlineOrders.paymentMethod,
      createdAt: onlineOrders.createdAt,
      collectedAt: onlineOrders.collectedAt,
      items: sql<number>`(select count(*)::int from online_order_lines l where l.order_id = online_orders.id)`,
    })
    .from(onlineOrders)
    .where(eq(onlineOrders.accountId, id))
    .orderBy(desc(onlineOrders.createdAt))
    .limit(100);
  const paid = orders.filter((o) => ["paid", "ready", "collected"].includes(o.status));
  const stats = {
    orders: orders.length,
    paidOrders: paid.length,
    spent: paid.reduce((a, o) => a + Number(o.total), 0).toFixed(2),
    collected: orders.filter((o) => o.status === "collected").length,
    lastOrderAt: orders[0]?.createdAt ?? null,
  };
  const history = await db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "shop_account"), eq(auditLogs.entityId, id)))
    .orderBy(desc(auditLogs.at))
    .limit(60);
  return { customer, orders, stats, history };
}

/** Disable a customer's account (they are signed out everywhere and can't sign in) or switch it back on. */
export async function setShopCustomerActive(actor: Actor, id: string, input: { active: boolean; reason?: string | null }) {
  requirePermission(actor, "customers.edit");
  const reason = input.reason?.trim().slice(0, 300) || null;
  if (!input.active && !reason) throw invalid("Say why the account is disabled");
  await getDb().transaction(async (tx) => {
    const [a] = await tx.select().from(shopAccounts).where(eq(shopAccounts.id, id)).for("update");
    if (!a) throw notFound("Customer");
    if (a.isActive === input.active) throw conflict(input.active ? "This account is already active." : "This account is already disabled.");
    await tx.update(shopAccounts).set({ isActive: input.active }).where(eq(shopAccounts.id, id));
    if (!input.active) await tx.delete(shopSessions).where(eq(shopSessions.accountId, id));
    await audit(tx, auditActorOf(actor), {
      action: input.active ? "shop.account_enabled" : "shop.account_disabled",
      entityType: "shop_account",
      entityId: id,
      summary: `${a.name} (${formatPhone(a.mobile)}) ${input.active ? "re-enabled" : "disabled"} by staff${reason ? `: ${reason}` : ""}`,
    });
  });
}

/** A customer who forgot their password asks the shop: staff set a new one, and the customer is signed out everywhere. */
export async function resetShopCustomerPassword(actor: Actor, id: string, password: string) {
  requirePermission(actor, "customers.edit");
  if (password.length < SHOP_PASSWORD_MIN) throw invalid(`Use at least ${SHOP_PASSWORD_MIN} characters`);
  if (password.length > 200) throw invalid("That password is too long");
  const passwordHash = await hashPassword(password);
  await getDb().transaction(async (tx) => {
    const [a] = await tx.select({ id: shopAccounts.id, name: shopAccounts.name, mobile: shopAccounts.mobile }).from(shopAccounts).where(eq(shopAccounts.id, id)).for("update");
    if (!a) throw notFound("Customer");
    await tx.update(shopAccounts).set({ passwordHash, failedLoginCount: 0, lockedUntil: null }).where(eq(shopAccounts.id, id));
    await tx.delete(shopSessions).where(eq(shopSessions.accountId, id));
    // The password itself is never written anywhere.
    await audit(tx, auditActorOf(actor), { action: "shop.password_reset_by_staff", entityType: "shop_account", entityId: id, summary: `New password set for ${a.name} (${formatPhone(a.mobile)}) by staff; signed out everywhere` });
  });
}
