import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/server/http";
import { shopSignUp } from "@/server/services/shop-auth";
import { SHOP_COOKIE, shopCookieOptions } from "@/server/auth/shop-session";

const body = z.object({
  name: z.string().trim().min(1).max(80),
  mobile: z.string().trim().min(10).max(20),
  password: z.string().min(1).max(200),
  email: z.string().trim().max(120).optional().nullable(),
});

/** Website customer sign-up; signs the customer in straight away. */
export const POST = api({ public: true }, async (ctx) => {
  const result = await shopSignUp(await ctx.body(body), ctx.client);
  const res = NextResponse.json({ ok: true, data: { account: result.account } }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SHOP_COOKIE, result.token, shopCookieOptions(result.expiresAt));
  return res;
});
