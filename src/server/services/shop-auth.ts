import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { shopAccounts, shopSessions } from "@/server/db/schema";
import { audit, type AuditActor } from "@/server/audit";
import { AppError, conflict, invalid } from "@/server/errors";
import { getDummyHash, hashPassword, verifyPassword } from "@/server/auth/password";
import { enforceRateLimit, hashIp } from "@/server/rate-limit";
import { hashToken } from "@/server/services/auth";
import { consumeEmailCode, emailVerificationRequired } from "@/server/services/shop-otp";
import { formatPhone, isValidEmail, normalizeMobile } from "@/lib/india";

/**
 * Website customers: sign up with a name, mobile number and password; sign in with the mobile and
 * password. Kept apart from staff accounts (own table, own cookie, no staff permissions ever).
 */

export const SHOP_SESSION_DAYS = 30;
export const SHOP_PASSWORD_MIN = 8;
const MAX_FAILED = 8;
const LOCK_MINUTES = 15;
const GENERIC_ERROR = "Wrong mobile number or password";

export interface ShopAccount {
  id: string;
  name: string;
  mobile: string;
  email: string | null;
  /** When the customer proved the email address with an emailed code; null if not (yet). */
  emailVerifiedAt: Date | null;
}

interface Client {
  ip: string;
  userAgent: string;
}

export function customerAuditActor(a: { name: string; mobile: string }, client?: Partial<Client>): AuditActor {
  return { userId: null, label: `customer ${a.name} (${formatPhone(a.mobile)})`, ip: client?.ip ?? null, userAgent: client?.userAgent ?? null };
}

async function startSession(accountId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SHOP_SESSION_DAYS * 86400_000);
  await getDb().insert(shopSessions).values({ id: hashToken(token), accountId, expiresAt });
  return { token, expiresAt };
}

export async function shopSignUp(input: { name: string; mobile: string; password: string; email?: string | null; emailCode?: string | null }, client: Client) {
  await enforceRateLimit(`shop-signup:${hashIp(client.ip)}`, 5, 60 * 60, "Too many new accounts from this device. Please try again in an hour.");
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) throw invalid("Please enter your name");
  const mobile = normalizeMobile(input.mobile);
  if (!mobile) throw invalid("Please enter a valid 10-digit mobile number");
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !isValidEmail(email)) throw invalid("Please enter a valid email address");
  // While email checking is on, the account is made only after the customer enters the code emailed to them.
  const verify = await emailVerificationRequired();
  if (verify && !email) throw invalid("Please enter your email address. We send a code to it to verify your account.");
  if (input.password.length < SHOP_PASSWORD_MIN) throw invalid(`Choose a password of at least ${SHOP_PASSWORD_MIN} characters`);
  if (input.password.length > 200) throw invalid("That password is too long");

  const db = getDb();
  const [existing] = await db.select({ id: shopAccounts.id }).from(shopAccounts).where(eq(shopAccounts.mobile, mobile));
  if (existing) throw conflict("An account with this mobile number already exists. Please sign in.");
  if (verify) {
    if (!input.emailCode?.trim()) throw invalid("Enter the 6-digit code we emailed you");
    await consumeEmailCode({ email: email!, purpose: "sign_up", code: input.emailCode });
  }
  const passwordHash = await hashPassword(input.password);
  const account = await db.transaction(async (tx) => {
    const [a] = await tx.insert(shopAccounts).values({ name, mobile, email, emailVerifiedAt: verify ? new Date() : null, passwordHash }).returning();
    await audit(tx, customerAuditActor(a, client), { action: "shop.signup", entityType: "shop_account", entityId: a.id, summary: `New website account ${name} (${formatPhone(mobile)})${verify ? ", email verified" : ""}` });
    return a;
  });
  const session = await startSession(account.id);
  return { ...session, account: toAccount(account) };
}

export async function shopSignIn(input: { mobile: string; password: string }, client: Client) {
  await enforceRateLimit(`shop-login:${hashIp(client.ip)}`, 20, 15 * 60, "Too many sign-in attempts from this device. Wait 15 minutes.");
  const mobile = normalizeMobile(input.mobile);
  const db = getDb();
  const [a] = mobile ? await db.select().from(shopAccounts).where(eq(shopAccounts.mobile, mobile)) : [];
  if (!a) {
    await verifyPassword(input.password, await getDummyHash()); // same time as a real check
    throw new AppError("UNAUTHENTICATED", GENERIC_ERROR);
  }
  if (!a.isActive) throw new AppError("UNAUTHENTICATED", GENERIC_ERROR);
  if (a.lockedUntil && a.lockedUntil > new Date()) throw new AppError("RATE_LIMITED", `Too many wrong passwords. Try again after ${LOCK_MINUTES} minutes, or ask the shop to reset it.`);
  if (!(await verifyPassword(input.password, a.passwordHash))) {
    const failed = a.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED;
    await db.transaction(async (tx) => {
      await tx
        .update(shopAccounts)
        .set({ failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : a.lockedUntil })
        .where(eq(shopAccounts.id, a.id));
      await audit(tx, customerAuditActor(a, client), {
        action: lock ? "shop.account_locked" : "shop.login_failed",
        entityType: "shop_account",
        entityId: a.id,
        summary: lock ? `Website account locked after ${failed} wrong passwords` : "Wrong password on website sign-in",
      });
    });
    throw new AppError("UNAUTHENTICATED", GENERIC_ERROR);
  }
  await db.update(shopAccounts).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(shopAccounts.id, a.id));
  const session = await startSession(a.id);
  return { ...session, account: toAccount(a) };
}

export async function shopAccountFromToken(token: string | undefined | null): Promise<ShopAccount | null> {
  if (!token) return null;
  const db = getDb();
  const [row] = await db
    .select({ a: shopAccounts })
    .from(shopSessions)
    .innerJoin(shopAccounts, eq(shopAccounts.id, shopSessions.accountId))
    .where(and(eq(shopSessions.id, hashToken(token)), gt(shopSessions.expiresAt, new Date()), eq(shopAccounts.isActive, true)));
  return row ? toAccount(row.a) : null;
}

export async function shopSignOut(token: string | undefined | null) {
  if (!token) return;
  await getDb().delete(shopSessions).where(eq(shopSessions.id, hashToken(token)));
}

function toAccount(a: typeof shopAccounts.$inferSelect): ShopAccount {
  return { id: a.id, name: a.name, mobile: a.mobile, email: a.email, emailVerifiedAt: a.emailVerifiedAt };
}

/** A signed-in customer proves (or changes to) an email address with the code emailed to it. */
export async function verifyAccountEmail(account: ShopAccount, input: { email: string; code: string }, client: Client) {
  const email = await consumeEmailCode({ email: input.email, purpose: "verify", code: input.code, accountId: account.id });
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(shopAccounts).set({ email, emailVerifiedAt: new Date() }).where(eq(shopAccounts.id, account.id));
    await audit(tx, customerAuditActor(account, client), { action: "shop.email_verified", entityType: "shop_account", entityId: account.id, summary: `Website account verified email ${email}` });
  });
  const [a] = await db.select().from(shopAccounts).where(eq(shopAccounts.id, account.id));
  return toAccount(a);
}
