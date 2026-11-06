import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type Tx } from "@/server/db/client";
import { couponBatches, coupons, onlineOrders, users } from "@/server/db/schema";
import { audit } from "@/server/audit";
import { auditActorOf, requirePermission, type Actor } from "@/server/auth/actor";
import { conflict, invalid, notFound } from "@/server/errors";
import { D, formatPrice, m } from "@/lib/money";

/**
 * Discount codes. The admin generates a batch of single-use codes, each worth a flat amount off an
 * online order (optionally with a minimum order value and an end date), and hands them out one by
 * one. A code is reserved while its order waits for payment, used once the payment is verified, and
 * freed again if that order is cancelled, expires or its payment is not found.
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L
export const MAX_CODES_PER_BATCH = 500;

function randomPart(n: number) {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

export function newCouponCode(): string {
  return `OM-${randomPart(4)}-${randomPart(4)}`;
}

/** What a customer typed → the stored form ("om 7k3f9qxd" → "OM-7K3F-9QXD"). */
export function normalizeCouponCode(raw: string): string {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (/^OM[A-Z0-9]{8}$/.test(s)) return `OM-${s.slice(2, 6)}-${s.slice(6)}`;
  return s;
}

export interface GenerateInput {
  label: string;
  amountOff: string;
  minOrder: string;
  count: number;
  validUntil: string | null; // YYYY-MM-DD, valid through the end of that day (IST)
}

export async function generateCoupons(actor: Actor, input: GenerateInput) {
  requirePermission(actor, "discounts.configure");
  const label = input.label.trim().slice(0, 80);
  if (!label) throw invalid("Give the batch a name, e.g. “Diwali ₹100 off”");
  const amountOff = D(input.amountOff);
  const minOrder = D(input.minOrder || "0");
  if (amountOff.lte(0) || amountOff.gt(100000)) throw invalid("The amount off must be between ₹1 and ₹1,00,000");
  if (minOrder.lt(0)) throw invalid("The minimum order can't be negative");
  if (minOrder.gt(0) && minOrder.lte(amountOff)) throw invalid("The minimum order must be more than the amount off");
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_CODES_PER_BATCH) throw invalid(`Generate between 1 and ${MAX_CODES_PER_BATCH} codes at a time`);
  let validUntil: Date | null = null;
  if (input.validUntil) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) throw invalid("Choose a valid end date");
    validUntil = new Date(`${input.validUntil}T23:59:59+05:30`);
    if (validUntil.getTime() < Date.now()) throw invalid("The end date is in the past");
  }

  return getDb().transaction(async (tx) => {
    const [batch] = await tx
      .insert(couponBatches)
      .values({ label, amountOff: m(amountOff), minOrder: m(minOrder), validUntil, codeCount: input.count, createdBy: actor.id })
      .returning();
    const codes = new Set<string>();
    while (codes.size < input.count) codes.add(newCouponCode());
    // A clash with an existing code is astronomically unlikely; skip it and top up if it happens.
    let inserted = (await tx.insert(coupons).values([...codes].map((code) => ({ code, batchId: batch.id }))).onConflictDoNothing().returning({ id: coupons.id })).length;
    while (inserted < input.count) {
      const more = await tx.insert(coupons).values({ code: newCouponCode(), batchId: batch.id }).onConflictDoNothing().returning({ id: coupons.id });
      inserted += more.length;
    }
    await audit(tx, auditActorOf(actor), {
      action: "coupon.generate",
      entityType: "coupon_batch",
      entityId: batch.id,
      summary: `Generated ${input.count} codes “${label}”: ${formatPrice(m(amountOff))} off${minOrder.gt(0) ? ` orders of ${formatPrice(m(minOrder))}+` : ""}${input.validUntil ? `, valid till ${input.validUntil}` : ""}`,
    });
    return batch;
  });
}

export async function listCouponBatches(actor: Actor) {
  requirePermission(actor, "discounts.configure");
  return getDb()
    .select({
      batch: couponBatches,
      createdByName: users.displayName,
      active: sql<number>`count(*) filter (where ${coupons.status} = 'active')::int`,
      reserved: sql<number>`count(*) filter (where ${coupons.status} = 'reserved')::int`,
      used: sql<number>`count(*) filter (where ${coupons.status} = 'used')::int`,
      disabled: sql<number>`count(*) filter (where ${coupons.status} = 'disabled')::int`,
    })
    .from(couponBatches)
    .leftJoin(coupons, eq(coupons.batchId, couponBatches.id))
    .leftJoin(users, eq(users.id, couponBatches.createdBy))
    .groupBy(couponBatches.id, users.displayName)
    .orderBy(desc(couponBatches.createdAt))
    .limit(200);
}

export async function getCouponBatch(actor: Actor, batchId: string) {
  requirePermission(actor, "discounts.configure");
  const db = getDb();
  const [batch] = await db.select().from(couponBatches).where(eq(couponBatches.id, batchId));
  if (!batch) throw notFound("Coupon batch");
  const codes = await db
    .select({ c: coupons, orderNumber: onlineOrders.orderNumber })
    .from(coupons)
    .leftJoin(onlineOrders, eq(onlineOrders.id, coupons.orderId))
    .where(eq(coupons.batchId, batchId))
    .orderBy(coupons.code);
  return { batch, codes: codes.map((r) => ({ ...r.c, orderNumber: r.orderNumber })) };
}

/** Stop a code (or every unused code in a batch) from being used. Reserved/used codes are left alone. */
export async function disableCoupons(actor: Actor, target: { couponId: string } | { batchId: string }) {
  requirePermission(actor, "discounts.configure");
  return getDb().transaction(async (tx) => {
    const where = "couponId" in target ? eq(coupons.id, target.couponId) : eq(coupons.batchId, target.batchId);
    const done = await tx
      .update(coupons)
      .set({ status: "disabled", disabledAt: new Date(), disabledBy: actor.id })
      .where(and(where, eq(coupons.status, "active")))
      .returning({ code: coupons.code });
    if ("couponId" in target && !done.length) throw conflict("Only an unused, active code can be disabled");
    await audit(tx, auditActorOf(actor), {
      action: "coupon.disable",
      entityType: "couponId" in target ? "coupon" : "coupon_batch",
      entityId: "couponId" in target ? target.couponId : target.batchId,
      summary: done.length === 1 ? `Disabled code ${done[0].code}` : `Disabled ${done.length} unused codes`,
    });
    return { disabled: done.length };
  });
}

export interface AppliedCoupon {
  id: string;
  code: string;
  amountOff: string;
  label: string;
}

/**
 * Check a code against a cart subtotal. With `lock`, the coupon row is locked for the rest of the
 * transaction so two orders can't take the same code at once.
 */
export async function evaluateCoupon(tx: Tx, rawCode: string, subtotal: string, opts: { lock?: boolean } = {}): Promise<AppliedCoupon> {
  const code = normalizeCouponCode(rawCode);
  if (!code) throw invalid("Enter a discount code");
  const q = tx.select({ c: coupons, b: couponBatches }).from(coupons).innerJoin(couponBatches, eq(couponBatches.id, coupons.batchId)).where(eq(coupons.code, code));
  const [row] = opts.lock ? await q.for("update", { of: coupons }) : await q;
  if (!row || row.c.status === "disabled") throw invalid("This code isn't valid. Check it and try again.");
  if (row.c.status === "used") throw invalid("This code has already been used.");
  if (row.c.status === "reserved") throw invalid("This code is already on another order waiting for payment.");
  if (row.b.validUntil && row.b.validUntil.getTime() < Date.now()) throw invalid("This code has expired.");
  const sub = D(subtotal);
  if (sub.lt(D(row.b.minOrder))) throw invalid(`This code needs an order of ${formatPrice(row.b.minOrder)} or more.`);
  if (sub.lte(D(row.b.amountOff))) throw invalid(`Your order must be more than ${formatPrice(row.b.amountOff)} to use this code.`);
  return { id: row.c.id, code: row.c.code, amountOff: row.b.amountOff, label: row.b.label };
}

/** Put a reserved code back into circulation (its order did not go through). */
export async function releaseCoupon(tx: Tx, couponId: string | null) {
  if (!couponId) return;
  await tx.update(coupons).set({ status: "active", orderId: null }).where(and(eq(coupons.id, couponId), eq(coupons.status, "reserved")));
}
