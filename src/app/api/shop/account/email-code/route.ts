import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { sendEmailCode } from "@/server/services/shop-otp";

const body = z.object({ email: z.string().trim().min(3).max(120) });

/** A signed-in customer asks for a code to prove their email address (before paying). */
export const POST = shopApi(async (ctx) => {
  const r = await sendEmailCode({ email: (await ctx.body(body)).email, purpose: "verify", accountId: ctx.account.id }, ctx.client);
  return { sent: true, cooldownSeconds: r.cooldownSeconds, expiresInMinutes: r.expiresInMinutes };
});
