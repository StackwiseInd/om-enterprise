import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { verifyAccountEmail } from "@/server/services/shop-auth";

const body = z.object({ email: z.string().trim().min(3).max(120), code: z.string().trim().min(4).max(12) });

/** The code arrived: the customer's email address is now verified. */
export const POST = shopApi(async (ctx) => {
  const b = await ctx.body(body);
  const account = await verifyAccountEmail(ctx.account, b, ctx.client);
  return { email: account.email, verified: true };
});
