import "server-only";
import { assertNotBlocked } from "@/server/services/shop-blocklist";
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { shopAccounts, shopOtps } from "@/server/db/schema";
import { emailConfigured, sendMail } from "@/server/email";
import { AppError, conflict, invalid, precondition } from "@/server/errors";
import { enforceRateLimit, hashIp } from "@/server/rate-limit";
import { getSettings } from "@/server/settings";
import { isValidEmail } from "@/lib/india";

/**
 * Proving an email address with a one-time code, for website customers.
 *
 * A 6-digit code is emailed; only a keyed hash of it is stored. It works once, for 10 minutes, with 5 tries.
 * Asking for codes is limited per address, per device and per day (so the form can't be used to flood an
 * inbox or use up the mailbox's sending allowance). The check is on only while email sending is set up AND
 * the owner hasn't switched it off in Settings → Website.
 */

export type OtpPurpose = "sign_up" | "verify";
const CODE_MINUTES = 10;
const MAX_TRIES = 5;
const COOLDOWN_SECONDS = 30;

/** Do customers have to verify their email? */
export async function emailVerificationRequired(): Promise<boolean> {
  if (!emailConfigured()) return false;
  const website = await getSettings("website").catch(() => null);
  return website?.requireEmailVerification ?? true;
}

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!isValidEmail(email) || email.length > 120) throw invalid("Please enter a valid email address");
  return email;
}

function hashCode(purpose: OtpPurpose, email: string, code: string) {
  const key = process.env.APP_SECRET ?? "dev-secret";
  return createHmac("sha256", key).update(`otp|${purpose}|${email}|${code}`).digest("hex");
}

/** Email a fresh code. Returns how long to wait before another can be asked for. */
export async function sendEmailCode(input: { email: string; purpose: OtpPurpose; accountId?: string | null }, client: { ip: string }) {
  const email = normalizeEmail(input.email);
  const db = getDb();
  const ipKey = hashIp(client.ip);
  await enforceRateLimit(`otp-ip:${ipKey}`, 15, 60 * 60, "Too many codes asked for from this device. Please try again in an hour.");
  await enforceRateLimit(`otp-email:${email}`, 5, 60 * 60, "Too many codes for this email address. Please try again in an hour.");
  await enforceRateLimit("otp-day", 400, 24 * 60 * 60, "We can't send more codes today. Please try again tomorrow, or call the shop.");

  // Addresses blocked for fraud get no codes.
  await assertNotBlocked({ email: [email] }, "to get an email code", client);

  // Another account already proved this address: one account per address.
  const holders = await db.select({ id: shopAccounts.id, verified: shopAccounts.emailVerifiedAt }).from(shopAccounts).where(sql`lower(${shopAccounts.email}) = ${email}`);
  const verifiedHolder = holders.find((h) => h.verified && h.id !== input.accountId);
  if (verifiedHolder) {
    throw conflict(input.purpose === "sign_up" ? "An account with this email already exists. Please sign in." : "This email address is already used by another account.");
  }

  const [last] = await db.select({ createdAt: shopOtps.createdAt }).from(shopOtps).where(and(eq(shopOtps.email, email), eq(shopOtps.purpose, input.purpose))).orderBy(desc(shopOtps.createdAt)).limit(1);
  if (last && Date.now() - last.createdAt.getTime() < COOLDOWN_SECONDS * 1000) {
    throw new AppError("RATE_LIMITED", `Please wait ${COOLDOWN_SECONDS} seconds before asking for another code.`);
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  // Only the newest code works.
  await db.update(shopOtps).set({ consumedAt: new Date() }).where(and(eq(shopOtps.email, email), eq(shopOtps.purpose, input.purpose), isNull(shopOtps.consumedAt)));
  const [row] = await db
    .insert(shopOtps)
    .values({ purpose: input.purpose, email, accountId: input.accountId ?? null, codeHash: hashCode(input.purpose, email, code), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000), ipHash: ipKey })
    .returning({ id: shopOtps.id });

  const business = await getSettings("business").catch(() => null);
  const shop = business?.name ?? "OM ENTERPRISE";
  try {
    await sendMail({
      to: email,
      subject: `${code} is your ${shop} verification code`,
      text: `Your ${shop} verification code is ${code}.\n\nIt works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email; nobody can use your address without this code.\n\nPlease don't share this code with anyone.`,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:0 auto;padding:24px;color:#0b1220">
<p style="margin:0 0 4px;font-size:13px;color:#5b6472">${shop}</p>
<h1 style="margin:0 0 16px;font-size:18px">Your verification code</h1>
<p style="margin:0 0 16px;font-size:34px;font-weight:700;letter-spacing:8px">${code}</p>
<p style="margin:0 0 8px;font-size:14px;line-height:1.5">It works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this email; nobody can use your address without this code.</p>
<p style="margin:0;font-size:13px;color:#5b6472">Please don't share this code with anyone.</p></div>`,
    });
  } catch (err) {
    console.error("[otp] couldn't send the code", err);
    await db.delete(shopOtps).where(eq(shopOtps.id, row.id));
    throw precondition("We couldn't send the code. Please check the email address and try again, or call the shop.");
  }
  return { email, cooldownSeconds: COOLDOWN_SECONDS, expiresInMinutes: CODE_MINUTES };
}

/** Check a code and use it up. Throws a clear message for a wrong, expired or used code. */
export async function consumeEmailCode(input: { email: string; purpose: OtpPurpose; code: string; accountId?: string | null }) {
  const email = normalizeEmail(input.email);
  const code = input.code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) throw invalid("Enter the 6-digit code from the email");
  // The outcome is decided inside the transaction but the error is raised after it commits: a wrong try must
  // stay counted, which it would not if throwing rolled the count back.
  const failure = await getDb().transaction(async (tx): Promise<string | null> => {
    const [c] = await tx
      .select()
      .from(shopOtps)
      .where(and(eq(shopOtps.email, email), eq(shopOtps.purpose, input.purpose), isNull(shopOtps.consumedAt), gt(shopOtps.expiresAt, new Date())))
      .orderBy(desc(shopOtps.createdAt))
      .limit(1)
      .for("update");
    if (!c || (input.accountId && c.accountId !== input.accountId)) return "That code has expired or was already used. Please ask for a new one.";
    if (c.attempts >= MAX_TRIES) {
      await tx.update(shopOtps).set({ consumedAt: new Date() }).where(eq(shopOtps.id, c.id));
      return "Too many wrong tries. Please ask for a new code.";
    }
    const given = Buffer.from(hashCode(input.purpose, email, code), "hex");
    const real = Buffer.from(c.codeHash, "hex");
    if (given.length !== real.length || !timingSafeEqual(given, real)) {
      await tx.update(shopOtps).set({ attempts: c.attempts + 1, ...(c.attempts + 1 >= MAX_TRIES ? { consumedAt: new Date() } : {}) }).where(eq(shopOtps.id, c.id));
      return c.attempts + 1 >= MAX_TRIES ? "That code isn't right. Please ask for a new one." : "That code isn't right. Check it and try again.";
    }
    await tx.update(shopOtps).set({ consumedAt: new Date() }).where(eq(shopOtps.id, c.id));
    return null;
  });
  if (failure) throw invalid(failure);
  return email;
}
