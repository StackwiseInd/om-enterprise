import { z } from "zod";
import { api } from "@/server/http";
import { generateCoupons, listCouponBatches } from "@/server/services/coupons";
import { moneyStr } from "@/lib/validation";

const body = z.object({
  label: z.string().trim().min(1).max(80),
  amountOff: moneyStr,
  minOrder: z.union([moneyStr, z.literal("")]).default(""),
  count: z.number().int().min(1).max(500),
  validUntil: z.string().trim().max(10).optional().nullable(),
});

export const GET = api({ permission: "discounts.configure" }, async (ctx) => listCouponBatches(ctx.actor));

/** Generate a batch of single-use flat-discount codes. */
export const POST = api({ permission: "discounts.configure" }, async (ctx) => {
  const b = await ctx.body(body);
  const batch = await generateCoupons(ctx.actor, { ...b, minOrder: b.minOrder || "0", validUntil: b.validUntil || null });
  return { batchId: batch.id };
});
