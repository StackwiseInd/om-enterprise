import "server-only";
import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { customers, documents, productVariants, products, roles, sales, users } from "@/server/db/schema";
import { can, loadActor, requirePermission, type Actor } from "@/server/auth/actor";
import { getAllSettings, getSettings } from "@/server/settings";
import { salesSummary } from "@/server/services/reports";
import { listPendingApprovals } from "@/server/services/sales";
import { countPendingPriceChanges } from "@/server/services/pricing";
import { newOrderCount } from "@/server/services/website-orders";
import { emailConfigured, sendMail } from "@/server/email";
import { approvalAlertEmail, dailySummaryEmail } from "@/server/email/owner-email";
import { whatsappConfigured } from "@/server/whatsapp";
import { istStartOfDay } from "@/lib/india";
import { D, m, type Dec } from "@/lib/money";
import type { Settings } from "@/lib/settings-schema";

/**
 * The owner's phone app (/admin/app) and the emails the owner gets: one day's money in plain figures,
 * what is waiting for them, what is left to set up, and one search box over bills, sales, customers
 * and products. Figures come from the same reports as the dashboard (training sales never count).
 */

export interface OwnerDay {
  day: string;
  bills: number;
  billed: string;
  received: string;
  refunded: string;
  byMethod: { method: string; amount: string }[];
  discounts: string;
  cancelledBills: number;
  unpaid: { count: number; amount: string };
}

/** One day (IST) of sales and money in, from the reports. */
export async function ownerDay(actor: Actor, date = new Date()): Promise<OwnerDay> {
  const from = istStartOfDay(date);
  const to = new Date(from.getTime() + 86400_000);
  const s = await salesSummary(actor, { from, to });
  const methods = new Map<string, Dec>();
  for (const c of s.collections.byMethod.filter((c) => c.direction === "in")) methods.set(c.method, (methods.get(c.method) ?? D(0)).plus(D(c.amount)));
  return {
    day: from.toISOString(),
    bills: s.bills.count,
    billed: s.netInvoiced,
    received: s.collections.received,
    refunded: s.collections.refunded,
    byMethod: [...methods].map(([method, amount]) => ({ method, amount: m(amount) })).sort((a, b) => Number(b.amount) - Number(a.amount)),
    discounts: s.bills.discounts,
    cancelledBills: s.cancelledBills.count,
    unpaid: { count: s.pendingPayments.count, amount: s.pendingPayments.amount },
  };
}

export interface Waiting {
  discounts: number;
  prices: number;
  orders: number;
}

/** What is waiting for the owner: discount requests, price changes, new website orders. */
export async function ownerWaiting(actor: Actor): Promise<Waiting> {
  return {
    discounts: can(actor, "discounts.approve") ? (await listPendingApprovals(actor)).length : 0,
    prices: can(actor, "prices.approve") ? await countPendingPriceChanges() : 0,
    orders: can(actor, "orders.view") ? await newOrderCount() : 0,
  };
}

export type SetupKey = "tax" | "upi" | "prices" | "staff" | "alerts" | "email" | "whatsapp";
export interface SetupItem {
  key: SetupKey;
  done: boolean;
  /** For "prices": how many are still waiting. */
  count?: number;
  /** For "tax": the GST registration type, once it is confirmed. */
  registrationType?: NonNullable<Settings["tax"]["registrationType"]>;
  /** Optional: the shop can work without it. */
  optional?: boolean;
  /** Where to do it in the app; none when it is done once on the server. */
  href: string | null;
}

/** The one-time setup, in the order the owner should do it. */
export async function setupChecklist(): Promise<SetupItem[]> {
  const s = await getAllSettings();
  const prices = await countPendingPriceChanges();
  const [staff] = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.isActive, true), sql`${roles.key} <> 'super_admin'`));
  return [
    { key: "tax", done: s.tax.registrationType !== null, registrationType: s.tax.registrationType ?? undefined, href: "/dashboard/settings?section=tax" },
    { key: "upi", done: s.payments.upiEnabled && !!s.payments.upiVpa.trim(), href: "/dashboard/settings?section=payments" },
    { key: "prices", done: prices === 0, count: prices, href: "/dashboard/approvals" },
    { key: "staff", done: staff.c > 0, href: "/dashboard/staff" },
    { key: "alerts", done: !!s.alerts.ownerEmail, href: "/dashboard/settings?section=alerts" },
    { key: "email", done: emailConfigured(), optional: true, href: null },
    { key: "whatsapp", done: whatsappConfigured(), optional: true, href: null },
  ];
}

export interface SearchHit {
  kind: "bill" | "sale" | "customer" | "product";
  id: string;
  title: string;
  detail: string;
  href: string;
}

/**
 * One box for everything: a bill or sale number, a customer's name or mobile, a product's name or SKU.
 * Each kind is shown only to someone allowed to see it.
 */
export async function ownerSearch(actor: Actor, raw: string): Promise<SearchHit[]> {
  requirePermission(actor, "dashboard.view");
  const q = raw.trim().slice(0, 60);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = q.replace(/\D/g, "");
  const db = getDb();
  const hits: SearchHit[] = [];

  if (can(actor, "sales.view_all")) {
    const docs = await db
      .select({ id: documents.id, number: documents.docNumber, type: documents.docType, status: documents.status, total: documents.grandTotal, buyer: sql<string | null>`${documents.snapshot}->'buyer'->>'name'` })
      .from(documents)
      .where(and(isNull(documents.deletedAt), eq(documents.isTraining, false), ilike(documents.docNumber, like)))
      .orderBy(sql`${documents.issuedAt} desc`)
      .limit(6);
    for (const d of docs)
      hits.push({ kind: "bill", id: d.id, title: d.number, detail: [`₹${d.total}`, d.buyer, d.status === "cancelled" ? "cancelled" : null].filter(Boolean).join(" · "), href: `/dashboard/documents/${d.id}` });
    const ss = await db
      .select({ id: sales.id, number: sales.saleNumber, status: sales.status, total: sales.grandTotal })
      .from(sales)
      .where(and(isNull(sales.deletedAt), eq(sales.isTraining, false), ilike(sales.saleNumber, like)))
      .orderBy(sql`${sales.createdAt} desc`)
      .limit(4);
    for (const s of ss) hits.push({ kind: "sale", id: s.id, title: s.number, detail: `₹${s.total} · ${s.status}`, href: `/dashboard/sales/${s.id}` });
  }

  if (can(actor, "customers.view")) {
    const cs = await db
      .select({ id: customers.id, name: customers.name, mobile: customers.mobile, city: customers.city })
      .from(customers)
      .where(or(ilike(customers.name, like), ...(digits.length >= 4 ? [ilike(customers.mobile, `%${digits}%`)] : [])))
      .orderBy(asc(customers.name))
      .limit(6);
    for (const c of cs) hits.push({ kind: "customer", id: c.id, title: c.name, detail: [c.mobile, c.city].filter(Boolean).join(" · "), href: `/dashboard/customers/${c.id}` });
  }

  if (can(actor, "catalog.view") || can(actor, "catalog.edit")) {
    const ps = await db
      .selectDistinctOn([products.id], { id: products.id, name: products.name, sku: productVariants.sku })
      .from(products)
      .innerJoin(productVariants, eq(productVariants.productId, products.id))
      .where(and(eq(products.isActive, true), or(ilike(products.name, like), ilike(productVariants.sku, like))))
      .orderBy(products.id)
      .limit(8);
    for (const p of ps) hits.push({ kind: "product", id: p.id, title: p.name, detail: p.sku, href: `/dashboard/products/${p.id}` });
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* Emails to the owner                                                 */
/* ------------------------------------------------------------------ */

const appUrl = (path: string) => {
  const base = process.env.APP_BASE_URL?.replace(/\/$/, "");
  return base ? `${base}${path}` : null;
};

/** The Super Admin the evening summary is worked out as (the reports need someone allowed to see them). */
async function ownerActor(): Promise<Actor | null> {
  const [u] = await getDb()
    .select({ id: users.id })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(roles.key, "super_admin"), eq(users.isActive, true)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return u ? loadActor(u.id) : null;
}

/** The evening summary, sent once a day by the scheduled job. Returns why nothing was sent, if so. */
export async function sendDailySummary(now = new Date()): Promise<{ sent: boolean; reason?: string; to?: string }> {
  const alerts = await getSettings("alerts");
  if (!alerts.dailySummary) return { sent: false, reason: "turned off" };
  if (!alerts.ownerEmail) return { sent: false, reason: "no owner email" };
  if (!emailConfigured()) return { sent: false, reason: "email not set up" };
  const actor = await ownerActor();
  if (!actor) return { sent: false, reason: "no Super Admin" };
  const business = await getSettings("business");
  const day = await ownerDay(actor, now);
  const waiting = await ownerWaiting(actor);
  const mail = dailySummaryEmail({ shop: business.name, day, waiting, appUrl: appUrl("/admin/app") });
  await sendMail({ to: alerts.ownerEmail, ...mail });
  return { sent: true, to: alerts.ownerEmail };
}

/** A note to the owner when staff ask for a discount approval. Never throws: the request itself already stands. */
export async function notifyApprovalRequest(req: { id: string; reason: string; details: unknown }, requestedBy: string) {
  try {
    const alerts = await getSettings("alerts");
    if (!alerts.approvalAlerts || !alerts.ownerEmail || !emailConfigured()) return;
    const d = (req.details ?? {}) as { saleNumber?: string; grandTotal?: string; maxDiscountPercent?: string };
    const business = await getSettings("business");
    const mail = approvalAlertEmail({
      shop: business.name,
      requestedBy,
      saleNumber: d.saleNumber ?? "",
      grandTotal: d.grandTotal ?? "0",
      discountPercent: d.maxDiscountPercent ?? null,
      reason: req.reason,
      appUrl: appUrl("/admin/app/approvals"),
    });
    await sendMail({ to: alerts.ownerEmail, ...mail });
  } catch (err) {
    console.error("Approval alert email not sent:", err instanceof Error ? err.message : err);
  }
}

export interface DayBill {
  id: string;
  number: string;
  total: string;
  buyer: string | null;
  status: string;
  issuedAt: Date;
}

/** The bills issued on one day (IST), newest first: for the owner's "Today's money" screen. */
export async function billsOn(actor: Actor, date = new Date(), limit = 30): Promise<DayBill[]> {
  if (!can(actor, "sales.view_all")) return [];
  const from = istStartOfDay(date);
  const to = new Date(from.getTime() + 86400_000);
  return getDb()
    .select({ id: documents.id, number: documents.docNumber, total: documents.grandTotal, buyer: sql<string | null>`${documents.snapshot}->'buyer'->>'name'`, status: documents.status, issuedAt: documents.issuedAt })
    .from(documents)
    .where(
      and(
        sql`${documents.docType} in ('tax_invoice','bill_of_supply','cash_memo')`,
        eq(documents.isTraining, false),
        isNull(documents.deletedAt),
        sql`${documents.issuedAt} >= ${from} and ${documents.issuedAt} < ${to}`,
      ),
    )
    .orderBy(sql`${documents.issuedAt} desc`)
    .limit(limit);
}
