import "server-only";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, type Tx } from "@/server/db/client";
import { onlineOrders, shopAccounts, shopBlocklist, shopDeletionRequests, shopOtps, shopSessions, users, type DeletionRequestStatus } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { auditActorOf, requirePermission, type Actor } from "@/server/auth/actor";
import { AppError, conflict, invalid, notFound } from "@/server/errors";
import { verifyPassword } from "@/server/auth/password";
import { enforceRateLimit, hashIp } from "@/server/rate-limit";
import { releaseCoupon } from "@/server/services/coupons";
import { customerAuditActor, type ShopAccount } from "@/server/services/shop-auth";
import { normalizeBlockValue } from "@/server/services/shop-blocklist";
import { deletePhrase } from "@/lib/delete-phrase";
import { formatPhone } from "@/lib/india";

/**
 * Keeping the website safe: staff freeze an account (on hold, reversible), ban one for fraud (its mobile and
 * email can never sign up or sign in again), keep a list of blocked numbers and addresses, and delete accounts,
 * on the customer's request or on their own. Every step is in the audit log.
 *
 * Deleting an account erases the person's details from it (name, mobile, email, address, password) and signs
 * them out everywhere. Their past orders stay, as the shop's sales record that tax law requires it to keep.
 */

type Client = { ip: string; userAgent: string };

/** "98xxxxx345": enough for staff to recognise a request after the account is gone. */
export const maskMobile = (m: string) => (/^\d{10}$/.test(m) ? `${m.slice(0, 2)}xxxxx${m.slice(-3)}` : "—");
const maskEmail = (e: string | null) => (e ? e.replace(/^(.)[^@]*(@.*)$/, "$1•••$2") : null);

/** Orders that hold money or goods for the customer; the account can't be deleted while one is open. */
const OPEN_WITH_MONEY = ["payment_submitted", "paid", "confirmed", "ready", "refunding"] as const;

async function lockAccount(tx: Tx, id: string) {
  const [a] = await tx.select().from(shopAccounts).where(eq(shopAccounts.id, id)).for("update");
  if (!a) throw notFound("Customer");
  return a;
}

/** Close the customer's orders still waiting for payment (a late payment is refunded automatically). */
async function closeUnpaidOrders(tx: Tx, accountId: string, why: string, actor: ReturnType<typeof auditActorOf>) {
  const open = await tx
    .update(onlineOrders)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: why, updatedAt: new Date() })
    .where(and(eq(onlineOrders.accountId, accountId), inArray(onlineOrders.status, ["awaiting_payment", "payment_failed"])))
    .returning({ id: onlineOrders.id, orderNumber: onlineOrders.orderNumber, couponId: onlineOrders.couponId, from: sql<string>`'open'` });
  for (const o of open) {
    await releaseCoupon(tx, o.couponId);
    await audit(tx, actor, { action: "online_order.cancelled", entityType: "online_order", entityId: o.id, summary: `${o.orderNumber} cancelled: ${why}` });
  }
  return open.length;
}

async function addBlocks(tx: Tx, actor: Actor, accountId: string | null, entries: { kind: "mobile" | "email"; value: string }[], reason: string) {
  const added: string[] = [];
  for (const e of entries) {
    const r = await tx
      .insert(shopBlocklist)
      .values({ kind: e.kind, value: e.value, reason, accountId, createdBy: actor.id })
      .onConflictDoNothing()
      .returning({ id: shopBlocklist.id });
    if (r.length) {
      added.push(`${e.kind} ${e.value}`);
      await audit(tx, auditActorOf(actor), { action: "shop.blocked", entityType: "shop_blocklist", entityId: r[0].id, summary: `Blocked ${e.kind} ${e.value}: ${reason}`, data: { accountId } });
    }
  }
  return added;
}

/* ------------------------------------------------------------------ */
/* Freeze · ban                                                        */
/* ------------------------------------------------------------------ */

/** Ban for fraud: signed out, open unpaid orders closed, and (by default) the mobile and email blocked for good. */
export async function banShopCustomer(actor: Actor, id: string, input: { reason: string; blockMobile?: boolean; blockEmail?: boolean; blockAltMobile?: boolean }) {
  requirePermission(actor, "customers.ban");
  const reason = input.reason.trim().slice(0, 300);
  if (reason.length < 3) throw invalid("Say why the account is banned (it is kept in the log)");
  return getDb().transaction(async (tx) => {
    const a = await lockAccount(tx, id);
    if (a.status === "deleted") throw conflict("This account has been deleted.");
    if (a.status === "banned") throw conflict("This account is already banned.");
    const now = new Date();
    await tx.update(shopAccounts).set({ status: "banned", isActive: false, statusReason: reason, statusChangedAt: now, statusChangedBy: actor.id }).where(eq(shopAccounts.id, id));
    await tx.delete(shopSessions).where(eq(shopSessions.accountId, id));
    const by = auditActorOf(actor);
    const closed = await closeUnpaidOrders(tx, id, `Account banned: ${reason}`, by);
    const entries: { kind: "mobile" | "email"; value: string }[] = [];
    if (input.blockMobile !== false) entries.push({ kind: "mobile", value: a.mobile });
    if (input.blockEmail !== false && a.email) entries.push({ kind: "email", value: a.email.toLowerCase() });
    if (input.blockAltMobile && a.altMobile) entries.push({ kind: "mobile", value: a.altMobile });
    const blocked = await addBlocks(tx, actor, id, entries, `Account ${a.name} banned: ${reason}`);
    await audit(tx, by, {
      action: "shop.account_banned",
      entityType: "shop_account",
      entityId: id,
      summary: `${a.name} (${formatPhone(a.mobile)}) banned: ${reason}${blocked.length ? `; blocked ${blocked.join(", ")}` : ""}${closed ? `; ${closed} unpaid order(s) closed` : ""}`,
      data: { reason, blocked, closedOrders: closed, previousStatus: a.status },
    });
    return { blocked, closedOrders: closed };
  });
}

/** Lift a ban; optionally also unblock the mobile and email that were blocked with it. */
export async function unbanShopCustomer(actor: Actor, id: string, input: { reason?: string | null; unblock?: boolean }) {
  requirePermission(actor, "customers.ban");
  const reason = input.reason?.trim().slice(0, 300) || null;
  return getDb().transaction(async (tx) => {
    const a = await lockAccount(tx, id);
    if (a.status !== "banned") throw conflict("This account isn't banned.");
    const now = new Date();
    await tx.update(shopAccounts).set({ status: "active", isActive: true, statusReason: reason, statusChangedAt: now, statusChangedBy: actor.id }).where(eq(shopAccounts.id, id));
    let unblocked: string[] = [];
    if (input.unblock !== false) {
      const rows = await tx
        .update(shopBlocklist)
        .set({ removedAt: now, removedBy: actor.id, removeReason: `Ban on ${a.name} lifted${reason ? `: ${reason}` : ""}` })
        .where(and(eq(shopBlocklist.accountId, id), isNull(shopBlocklist.removedAt)))
        .returning({ kind: shopBlocklist.kind, value: shopBlocklist.value });
      unblocked = rows.map((r) => `${r.kind} ${r.value}`);
    }
    await audit(tx, auditActorOf(actor), {
      action: "shop.account_unbanned",
      entityType: "shop_account",
      entityId: id,
      summary: `Ban on ${a.name} (${formatPhone(a.mobile)}) lifted${reason ? `: ${reason}` : ""}${unblocked.length ? `; unblocked ${unblocked.join(", ")}` : ""}`,
    });
    return { unblocked };
  });
}

/* ------------------------------------------------------------------ */
/* Blocklist                                                           */
/* ------------------------------------------------------------------ */

/**
 * Block a mobile number or email address on its own (say, one a fraudster used by phone). Any website account
 * that uses it is banned at the same time.
 */
export async function addToBlocklist(actor: Actor, input: { kind: "mobile" | "email"; value: string; reason: string }) {
  requirePermission(actor, "customers.ban");
  const value = normalizeBlockValue(input.kind, input.value);
  if (!value) throw invalid(input.kind === "mobile" ? "Enter a 10-digit mobile number" : "Enter a valid email address", { field: "value" });
  const reason = input.reason.trim().slice(0, 300);
  if (reason.length < 3) throw invalid("Say why it is blocked (it is kept in the log)", { field: "reason" });
  return getDb().transaction(async (tx) => {
    const added = await addBlocks(tx, actor, null, [{ kind: input.kind, value }], reason);
    if (!added.length) throw conflict(`This ${input.kind === "mobile" ? "number" : "address"} is already blocked.`);
    // Accounts using it are banned too, so nobody stays signed in with it.
    const match =
      input.kind === "mobile"
        ? or(eq(shopAccounts.mobile, value), eq(shopAccounts.altMobile, value))
        : sql`lower(${shopAccounts.email}) = ${value}`;
    const accounts = await tx
      .select({ id: shopAccounts.id, name: shopAccounts.name, mobile: shopAccounts.mobile })
      .from(shopAccounts)
      .where(and(match, inArray(shopAccounts.status, ["active", "frozen"])))
      .for("update");
    const now = new Date();
    for (const a of accounts) {
      await tx.update(shopAccounts).set({ status: "banned", isActive: false, statusReason: `Blocked ${input.kind} ${value}: ${reason}`, statusChangedAt: now, statusChangedBy: actor.id }).where(eq(shopAccounts.id, a.id));
      await tx.delete(shopSessions).where(eq(shopSessions.accountId, a.id));
      await closeUnpaidOrders(tx, a.id, `Account banned: ${reason}`, auditActorOf(actor));
      await audit(tx, auditActorOf(actor), { action: "shop.account_banned", entityType: "shop_account", entityId: a.id, summary: `${a.name} (${formatPhone(a.mobile)}) banned because ${input.kind} ${value} was blocked: ${reason}` });
    }
    return { value, bannedAccounts: accounts.length };
  });
}

export async function removeFromBlocklist(actor: Actor, id: string, input: { reason: string }) {
  requirePermission(actor, "customers.ban");
  const reason = input.reason.trim().slice(0, 300);
  if (reason.length < 3) throw invalid("Say why it is unblocked (it is kept in the log)");
  await getDb().transaction(async (tx) => {
    const [b] = await tx.select().from(shopBlocklist).where(eq(shopBlocklist.id, id)).for("update");
    if (!b) throw notFound("Blocked entry");
    if (b.removedAt) throw conflict("This entry was already unblocked.");
    await tx.update(shopBlocklist).set({ removedAt: new Date(), removedBy: actor.id, removeReason: reason }).where(eq(shopBlocklist.id, id));
    await audit(tx, auditActorOf(actor), { action: "shop.unblocked", entityType: "shop_blocklist", entityId: id, summary: `Unblocked ${b.kind} ${b.value}: ${reason}` });
  });
}

export async function listBlocklist(actor: Actor, opts: { q?: string; show?: "active" | "removed" | "all" } = {}) {
  requirePermission(actor, "customers.view");
  const creator = alias(users, "creator");
  const remover = alias(users, "remover");
  const term = opts.q?.trim().slice(0, 80);
  const like = term ? `%${term.replace(/[\\%_]/g, "\\$&")}%` : null;
  const digits = term?.replace(/\D/g, "") ?? "";
  const show = opts.show ?? "active";
  return getDb()
    .select({
      b: shopBlocklist,
      createdByName: creator.displayName,
      removedByName: remover.displayName,
      accountName: shopAccounts.name,
      accountStatus: shopAccounts.status,
    })
    .from(shopBlocklist)
    .leftJoin(creator, eq(creator.id, shopBlocklist.createdBy))
    .leftJoin(remover, eq(remover.id, shopBlocklist.removedBy))
    .leftJoin(shopAccounts, eq(shopAccounts.id, shopBlocklist.accountId))
    .where(
      and(
        show === "active" ? isNull(shopBlocklist.removedAt) : show === "removed" ? isNotNull(shopBlocklist.removedAt) : undefined,
        like ? or(ilike(shopBlocklist.value, digits.length >= 3 ? `%${digits}%` : like), ilike(shopBlocklist.value, like), ilike(shopBlocklist.reason, like)) : undefined,
      ),
    )
    .orderBy(desc(shopBlocklist.createdAt))
    .limit(500);
}

/* ------------------------------------------------------------------ */
/* Deletion requests (customer)                                        */
/* ------------------------------------------------------------------ */

/** The customer asks for their account to be deleted; their password confirms it is really them. */
export async function requestAccountDeletion(account: ShopAccount, input: { password: string; reason?: string | null }, client: Client) {
  await enforceRateLimit(`shop-delete-req:${account.id}`, 5, 60 * 60, "Too many attempts. Please wait a little.");
  const db = getDb();
  const [a] = await db.select().from(shopAccounts).where(eq(shopAccounts.id, account.id));
  if (!a) throw notFound("Account");
  if (!(await verifyPassword(input.password, a.passwordHash))) throw new AppError("VALIDATION", "Your password isn't right", { field: "password" });
  const reason = input.reason?.trim().slice(0, 500) || null;
  return db.transaction(async (tx) => {
    const [pending] = await tx.select({ id: shopDeletionRequests.id }).from(shopDeletionRequests).where(and(eq(shopDeletionRequests.accountId, a.id), eq(shopDeletionRequests.status, "pending")));
    if (pending) throw conflict("You have already asked for your account to be deleted. The shop will complete it shortly.");
    const [r] = await tx.insert(shopDeletionRequests).values({ accountId: a.id, name: a.name, mobile: a.mobile, email: a.email, reason, ipHash: hashIp(client.ip) }).returning();
    await audit(tx, customerAuditActor(a, client), { action: "shop.deletion_requested", entityType: "shop_account", entityId: a.id, summary: `${a.name} asked for the website account to be deleted${reason ? `: ${reason}` : ""}`, data: { requestId: r.id } });
    return r;
  });
}

export async function myDeletionRequest(account: ShopAccount) {
  const [r] = await getDb()
    .select({ id: shopDeletionRequests.id, requestedAt: shopDeletionRequests.requestedAt, reason: shopDeletionRequests.reason })
    .from(shopDeletionRequests)
    .where(and(eq(shopDeletionRequests.accountId, account.id), eq(shopDeletionRequests.status, "pending")));
  return r ?? null;
}

/** The customer changed their mind. */
export async function withdrawDeletionRequest(account: ShopAccount, client: Client) {
  await getDb().transaction(async (tx) => {
    const r = await tx
      .update(shopDeletionRequests)
      .set({ status: "withdrawn", decidedAt: new Date(), decisionNote: "Withdrawn by the customer" })
      .where(and(eq(shopDeletionRequests.accountId, account.id), eq(shopDeletionRequests.status, "pending")))
      .returning({ id: shopDeletionRequests.id });
    if (!r.length) throw conflict("There is no deletion request to withdraw.");
    await audit(tx, customerAuditActor(account, client), { action: "shop.deletion_withdrawn", entityType: "shop_account", entityId: account.id, summary: `${account.name} withdrew the request to delete the account` });
  });
}

/* ------------------------------------------------------------------ */
/* Deletion requests (staff) and deleting an account                   */
/* ------------------------------------------------------------------ */

export const DELETION_STATUSES: DeletionRequestStatus[] = ["pending", "completed", "rejected", "withdrawn"];

export async function listDeletionRequests(actor: Actor, opts: { status?: DeletionRequestStatus | "all"; q?: string } = {}) {
  requirePermission(actor, "customers.view");
  const decider = alias(users, "decider");
  const term = opts.q?.trim().slice(0, 80);
  const like = term ? `%${term.replace(/[\\%_]/g, "\\$&")}%` : null;
  const digits = term?.replace(/\D/g, "") ?? "";
  const status = opts.status ?? "pending";
  return getDb()
    .select({
      r: shopDeletionRequests,
      decidedByName: decider.displayName,
      accountStatus: shopAccounts.status,
      orders: sql<number>`(select count(*)::int from online_orders o where o.account_id = ${shopDeletionRequests.accountId} and o.deleted_at is null)`,
      openOrders: sql<number>`(select count(*)::int from online_orders o where o.account_id = ${shopDeletionRequests.accountId} and o.deleted_at is null and o.status in ('payment_submitted','paid','confirmed','ready','refunding'))`,
    })
    .from(shopDeletionRequests)
    .leftJoin(decider, eq(decider.id, shopDeletionRequests.decidedBy))
    .leftJoin(shopAccounts, eq(shopAccounts.id, shopDeletionRequests.accountId))
    .where(
      and(
        status === "all" ? undefined : eq(shopDeletionRequests.status, status),
        like ? or(ilike(shopDeletionRequests.name, like), ilike(shopDeletionRequests.mobile, digits.length >= 3 ? `%${digits}%` : like), ilike(shopDeletionRequests.email, like)) : undefined,
      ),
    )
    .orderBy(status === "pending" ? shopDeletionRequests.requestedAt : desc(shopDeletionRequests.requestedAt))
    .limit(300);
}

export async function deletionRequestCounts() {
  const rows = await getDb().select({ status: shopDeletionRequests.status, n: sql<number>`count(*)::int` }).from(shopDeletionRequests).groupBy(shopDeletionRequests.status);
  const out: Record<DeletionRequestStatus, number> = { pending: 0, completed: 0, rejected: 0, withdrawn: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

/** Why this account can't be deleted yet, or null. */
export async function deleteBlockedFor(accountId: string): Promise<string | null> {
  const open = await getDb()
    .select({ n: onlineOrders.orderNumber, status: onlineOrders.status })
    .from(onlineOrders)
    .where(and(eq(onlineOrders.accountId, accountId), isNull(onlineOrders.deletedAt), inArray(onlineOrders.status, [...OPEN_WITH_MONEY])));
  if (!open.length) return null;
  return `${open.map((o) => o.n).join(", ")} ${open.length === 1 ? "is" : "are"} paid and not yet handed over or refunded. Hand ${open.length === 1 ? "it" : "them"} over or refund ${open.length === 1 ? "it" : "them"} first.`;
}

/**
 * Delete a website account: on the customer's request (`requestId`) or by staff. The name, mobile, email,
 * profile and password are erased, every device is signed out, unpaid orders are closed. Past orders stay as
 * the shop's sales record. With `block`, the mobile and email are also blocked (fraud).
 */
export async function deleteShopAccount(actor: Actor, id: string, input: { confirm: string; reason?: string | null; requestId?: string | null; block?: boolean }) {
  requirePermission(actor, "customers.ban");
  if (input.confirm.trim() !== deletePhrase(actor.username)) throw invalid(`Paste ${deletePhrase(actor.username)} exactly to confirm`, { field: "confirm" });
  const blocked = await deleteBlockedFor(id);
  if (blocked) throw conflict(blocked);
  const reason = input.reason?.trim().slice(0, 300) || (input.requestId ? "Customer asked for the account to be deleted" : "Deleted by staff");
  return getDb().transaction(async (tx) => {
    const a = await lockAccount(tx, id);
    if (a.status === "deleted") throw conflict("This account is already deleted.");
    const by = auditActorOf(actor);
    const now = new Date();
    const blockedNow = input.block
      ? await addBlocks(
          tx,
          actor,
          id,
          [{ kind: "mobile" as const, value: a.mobile }, ...(a.email ? [{ kind: "email" as const, value: a.email.toLowerCase() }] : [])],
          `Account ${a.name} deleted and blocked: ${reason}`,
        )
      : [];
    const closed = await closeUnpaidOrders(tx, id, "Customer account deleted", by);
    await tx.delete(shopSessions).where(eq(shopSessions.accountId, id));
    await tx.delete(shopOtps).where(eq(shopOtps.accountId, id));
    await tx
      .update(shopAccounts)
      .set({
        name: "Deleted customer",
        mobile: `deleted:${a.id}`,
        email: null,
        emailVerifiedAt: null,
        passwordHash: "!deleted",
        businessName: null,
        gstin: null,
        altMobile: null,
        addressLine1: null,
        addressLine2: null,
        landmark: null,
        city: null,
        state: null,
        pincode: null,
        failedLoginCount: 0,
        lockedUntil: null,
        status: "deleted",
        isActive: false,
        statusReason: reason,
        statusChangedAt: now,
        statusChangedBy: actor.id,
        deletedAt: now,
      })
      .where(eq(shopAccounts.id, id));
    // Requests keep only a masked trace of who asked.
    await tx.update(shopDeletionRequests).set({ name: "Deleted customer", mobile: maskMobile(a.mobile), email: maskEmail(a.email) }).where(eq(shopDeletionRequests.accountId, id));
    const req = await tx
      .update(shopDeletionRequests)
      .set({ status: "completed", decidedAt: now, decidedBy: actor.id, decisionNote: reason })
      .where(and(eq(shopDeletionRequests.accountId, id), eq(shopDeletionRequests.status, "pending")))
      .returning({ id: shopDeletionRequests.id });
    await audit(tx, by, {
      action: "shop.account_deleted",
      entityType: "shop_account",
      entityId: id,
      summary: `Website account ${maskMobile(a.mobile)} deleted${req.length ? " on the customer's request" : ""}: ${reason}${blockedNow.length ? "; mobile and email blocked" : ""}${closed ? `; ${closed} unpaid order(s) closed` : ""}`,
      data: { reason, requestId: req[0]?.id ?? null, blocked: blockedNow.length > 0, closedOrders: closed },
    });
    return { completedRequest: req.length > 0 };
  });
}

/** Staff decide not to delete (for example the request didn't come from the customer). */
export async function rejectDeletionRequest(actor: Actor, requestId: string, input: { note: string }) {
  requirePermission(actor, "customers.ban");
  const note = input.note.trim().slice(0, 300);
  if (note.length < 3) throw invalid("Say why, so the customer can be told");
  await getDb().transaction(async (tx) => {
    const [r] = await tx.select().from(shopDeletionRequests).where(eq(shopDeletionRequests.id, requestId)).for("update");
    if (!r) throw notFound("Deletion request");
    if (r.status !== "pending") throw conflict("This request has already been handled.");
    await tx.update(shopDeletionRequests).set({ status: "rejected", decidedAt: new Date(), decidedBy: actor.id, decisionNote: note }).where(eq(shopDeletionRequests.id, requestId));
    await audit(tx, auditActorOf(actor), { action: "shop.deletion_rejected", entityType: "shop_account", entityId: r.accountId, summary: `Request to delete ${r.name}'s account turned down: ${note}` });
  });
}
