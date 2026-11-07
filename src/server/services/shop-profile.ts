import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { shopAccounts, shopSessions, type OrderCustomerDetails } from "@/server/db/schema";
import { audit, diff } from "@/server/audit";
import { AppError, invalid, notFound } from "@/server/errors";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { enforceRateLimit } from "@/server/rate-limit";
import { hashToken } from "@/server/services/auth";
import { customerAuditActor, SHOP_PASSWORD_MIN, type ShopAccount } from "@/server/services/shop-auth";
import { isValidPincode, normalizeMobile, STATES, validateGstin } from "@/lib/india";
import { profileAddressLines, type ShopProfileFields } from "@/lib/shop-profile";

/**
 * My profile for website customers: name, a second phone, business name and GSTIN (for their bill), and the
 * address. The mobile number is the sign-in and stays as it is; the email changes only through a code
 * (verifyAccountEmail). Every change is in the account's history, with what changed.
 */

type Client = { ip: string; userAgent: string };

export interface ShopProfile extends ShopProfileFields {
  name: string;
  mobile: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  profileUpdatedAt: Date | null;
}

const PROFILE_COLUMNS = {
  name: shopAccounts.name,
  mobile: shopAccounts.mobile,
  email: shopAccounts.email,
  emailVerifiedAt: shopAccounts.emailVerifiedAt,
  createdAt: shopAccounts.createdAt,
  profileUpdatedAt: shopAccounts.profileUpdatedAt,
  businessName: shopAccounts.businessName,
  gstin: shopAccounts.gstin,
  altMobile: shopAccounts.altMobile,
  addressLine1: shopAccounts.addressLine1,
  addressLine2: shopAccounts.addressLine2,
  landmark: shopAccounts.landmark,
  city: shopAccounts.city,
  state: shopAccounts.state,
  pincode: shopAccounts.pincode,
};

export async function getProfileById(accountId: string): Promise<ShopProfile> {
  const [p] = await getDb().select(PROFILE_COLUMNS).from(shopAccounts).where(eq(shopAccounts.id, accountId));
  if (!p) throw notFound("Account");
  return p;
}

export const getMyProfile = (account: ShopAccount) => getProfileById(account.id);

/** What an order keeps of the profile, so its receipt prints the details as they were when it was placed. */
export function orderDetailsFrom(p: ShopProfileFields): OrderCustomerDetails {
  return { businessName: p.businessName, gstin: p.gstin, altMobile: p.altMobile, address: profileAddressLines(p) };
}

export interface ProfileInput {
  name: string;
  businessName?: string | null;
  gstin?: string | null;
  altMobile?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  landmark?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
}

const clean = (v: string | null | undefined, max: number) => {
  const s = (v ?? "").trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
};

/** Checks and tidies what the customer typed; the error names the field to fix. */
export function normalizeProfile(input: ProfileInput, mobile: string): { name: string } & ShopProfileFields {
  const name = clean(input.name, 80);
  if (!name || name.length < 2) throw invalid("Please enter your name", { field: "name" });
  let gstin: string | null = null;
  if (clean(input.gstin, 20)) {
    const g = validateGstin(input.gstin!);
    if (!g.ok) throw invalid(g.error, { field: "gstin" });
    gstin = g.normalized;
  }
  let altMobile: string | null = null;
  if (clean(input.altMobile, 20)) {
    altMobile = normalizeMobile(input.altMobile);
    if (!altMobile) throw invalid("The other phone number should be a 10-digit mobile number", { field: "altMobile" });
    if (altMobile === mobile) throw invalid("The other phone number is the same as your sign-in number. Leave it empty, or give a different one.", { field: "altMobile" });
  }
  const pincode = clean(input.pincode, 6)?.replace(/\s/g, "") ?? null;
  if (pincode && !isValidPincode(pincode)) throw invalid("PIN code is 6 digits, e.g. 396445", { field: "pincode" });
  const state = clean(input.state, 60);
  if (state && !STATES.some((s) => s.name === state)) throw invalid("Choose your state from the list", { field: "state" });
  const p = {
    name,
    businessName: clean(input.businessName, 120),
    gstin,
    altMobile,
    addressLine1: clean(input.addressLine1, 150),
    addressLine2: clean(input.addressLine2, 150),
    landmark: clean(input.landmark, 100),
    city: clean(input.city, 60),
    state,
    pincode,
  };
  // An address is either left out, or complete enough to find.
  const anyAddress = p.addressLine1 || p.addressLine2 || p.landmark || p.city || p.pincode;
  if (anyAddress && !p.addressLine1) throw invalid("Add the first line of the address (house / shop number and street)", { field: "addressLine1" });
  if (anyAddress && !p.city) throw invalid("Add the town or city", { field: "city" });
  if (anyAddress && !p.state) throw invalid("Choose the state", { field: "state" });
  if (anyAddress && !p.pincode) throw invalid("Add the PIN code", { field: "pincode" });
  return p;
}

export async function updateMyProfile(account: ShopAccount, input: ProfileInput, client: Client): Promise<ShopProfile> {
  await enforceRateLimit(`shop-profile:${account.id}`, 30, 60 * 60, "Too many changes in an hour. Please wait a little.");
  const before = await getMyProfile(account);
  const next = normalizeProfile(input, account.mobile);
  const pick = (p: typeof next | ShopProfile) => ({ name: p.name, businessName: p.businessName, gstin: p.gstin, altMobile: p.altMobile, addressLine1: p.addressLine1, addressLine2: p.addressLine2, landmark: p.landmark, city: p.city, state: p.state, pincode: p.pincode });
  const changes = diff(pick(before), pick(next));
  if (!Object.keys(changes).length) return before;
  await getDb().transaction(async (tx) => {
    await tx.update(shopAccounts).set({ ...next, profileUpdatedAt: new Date() }).where(eq(shopAccounts.id, account.id));
    await audit(tx, customerAuditActor({ name: next.name, mobile: account.mobile }, client), {
      action: "shop.profile_updated",
      entityType: "shop_account",
      entityId: account.id,
      summary: `Profile updated: ${Object.keys(changes).map((k) => FIELD_LABEL[k] ?? k).join(", ")}`,
      data: { changes },
    });
  });
  return getMyProfile(account);
}

const FIELD_LABEL: Record<string, string> = {
  name: "name",
  businessName: "business name",
  gstin: "GSTIN",
  altMobile: "other phone",
  addressLine1: "address",
  addressLine2: "address line 2",
  landmark: "landmark",
  city: "city",
  state: "state",
  pincode: "PIN code",
};

/** The customer changes their own password; every other device is signed out. */
export async function changeMyPassword(account: ShopAccount, input: { current: string; next: string }, currentToken: string | null | undefined, client: Client) {
  await enforceRateLimit(`shop-password:${account.id}`, 8, 15 * 60, "Too many attempts. Please wait 15 minutes.");
  if (input.next.length < SHOP_PASSWORD_MIN) throw invalid(`Choose a new password of at least ${SHOP_PASSWORD_MIN} characters`, { field: "next" });
  if (input.next.length > 200) throw invalid("That password is too long", { field: "next" });
  if (input.next === input.current) throw invalid("The new password is the same as the current one", { field: "next" });
  const db = getDb();
  const [a] = await db.select({ hash: shopAccounts.passwordHash }).from(shopAccounts).where(eq(shopAccounts.id, account.id));
  if (!a) throw notFound("Account");
  if (!(await verifyPassword(input.current, a.hash))) throw new AppError("VALIDATION", "Your current password isn't right", { field: "current" });
  const passwordHash = await hashPassword(input.next);
  await db.transaction(async (tx) => {
    await tx.update(shopAccounts).set({ passwordHash, failedLoginCount: 0, lockedUntil: null }).where(eq(shopAccounts.id, account.id));
    const keep = currentToken ? hashToken(currentToken) : "";
    await tx.delete(shopSessions).where(and(eq(shopSessions.accountId, account.id), ne(shopSessions.id, keep)));
    await audit(tx, customerAuditActor(account, client), { action: "shop.password_changed", entityType: "shop_account", entityId: account.id, summary: "Password changed by the customer; other devices signed out" });
  });
}
