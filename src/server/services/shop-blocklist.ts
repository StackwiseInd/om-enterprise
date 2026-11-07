import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { shopBlocklist } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { AppError } from "@/server/errors";
import { hashIp } from "@/server/rate-limit";
import { normalizeMobile } from "@/lib/india";

/**
 * The check every website entry point makes: is this mobile number or email address blocked for fraud?
 * A blocked number or address can't sign up, sign in, get an email code, or be added to a profile. Each try
 * is counted on the entry and written to the audit log, so staff see who keeps trying.
 */

export const BLOCKED_SIGN_UP = "We can't open a website account with these details. Please contact the shop.";
export const BLOCKED_SIGN_IN = "This account can't be used on the website. Please contact the shop.";

export const normalizeBlockValue = (kind: "mobile" | "email", value: string): string | null =>
  kind === "mobile" ? normalizeMobile(value) : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim()) ? value.trim().toLowerCase() : null;

/** Active entries matching any of these values. */
export async function findBlocks(values: { mobile?: (string | null | undefined)[]; email?: (string | null | undefined)[] }) {
  const mobiles = (values.mobile ?? []).map((m) => (m ? normalizeMobile(m) : null)).filter((m): m is string => !!m);
  const emails = (values.email ?? []).map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e);
  if (!mobiles.length && !emails.length) return [];
  const conds = [
    mobiles.length ? and(eq(shopBlocklist.kind, "mobile"), inArray(shopBlocklist.value, mobiles)) : undefined,
    emails.length ? and(eq(shopBlocklist.kind, "email"), inArray(shopBlocklist.value, emails)) : undefined,
  ].filter((c) => !!c);
  return getDb()
    .select({ id: shopBlocklist.id, kind: shopBlocklist.kind, value: shopBlocklist.value })
    .from(shopBlocklist)
    .where(and(isNull(shopBlocklist.removedAt), or(...conds)));
}

/**
 * Throws FORBIDDEN if any of these is blocked, after counting the try. `where` says what was attempted, for the
 * log ("sign-up", "sign-in", "email code", "profile").
 */
export async function assertNotBlocked(values: { mobile?: (string | null | undefined)[]; email?: (string | null | undefined)[] }, where: string, client?: { ip?: string; userAgent?: string }, message = BLOCKED_SIGN_UP) {
  const hits = await findBlocks(values);
  if (!hits.length) return;
  await getDb().transaction(async (tx) => {
    await tx
      .update(shopBlocklist)
      .set({ hits: sql`${shopBlocklist.hits} + 1`, lastHitAt: new Date() })
      .where(inArray(shopBlocklist.id, hits.map((h) => h.id)));
    await audit(tx, { userId: null, label: "website (blocked)", ip: client?.ip ?? null, userAgent: client?.userAgent ?? null }, {
      action: "shop.blocked_attempt",
      entityType: "shop_blocklist",
      entityId: hits[0].id,
      summary: `Blocked ${hits.map((h) => `${h.kind} ${h.value}`).join(" and ")} tried ${where}; refused`,
      data: { where, ipHash: client?.ip ? hashIp(client.ip) : null },
    });
  });
  throw new AppError("FORBIDDEN", message, { blocked: true });
}
