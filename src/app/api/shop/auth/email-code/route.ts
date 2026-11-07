import { z } from "zod";
import { api } from "@/server/http";
import { sendEmailCode } from "@/server/services/shop-otp";

const body = z.object({ email: z.string().trim().min(3).max(120) });

/** Sign-up step: email a verification code to the address the customer typed. */
export const POST = api({ public: true }, async (ctx) => {
  const r = await sendEmailCode({ email: (await ctx.body(body)).email, purpose: "sign_up" }, ctx.client);
  return { sent: true, cooldownSeconds: r.cooldownSeconds, expiresInMinutes: r.expiresInMinutes };
});
