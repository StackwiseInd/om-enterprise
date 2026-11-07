import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { getMyProfile, updateMyProfile } from "@/server/services/shop-profile";

const opt = (max: number) => z.string().max(max).optional().nullable();
const body = z.object({
  name: z.string().max(100),
  businessName: opt(150),
  gstin: opt(30),
  altMobile: opt(20),
  addressLine1: opt(200),
  addressLine2: opt(200),
  landmark: opt(120),
  city: opt(80),
  state: opt(80),
  pincode: opt(12),
});

export const GET = shopApi(async (ctx) => ({ profile: await getMyProfile(ctx.account) }));

/** The customer saves My profile. */
export const PATCH = shopApi(async (ctx) => ({ profile: await updateMyProfile(ctx.account, await ctx.body(body), ctx.client) }));
