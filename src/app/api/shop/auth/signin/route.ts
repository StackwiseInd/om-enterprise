import { NextResponse } from "next/server";
import { z } from "zod";
import { api } from "@/server/http";
import { shopSignIn } from "@/server/services/shop-auth";
import { SHOP_COOKIE, shopCookieOptions } from "@/server/auth/shop-session";

const body = z.object({ mobile: z.string().trim().min(1).max(20), password: z.string().min(1).max(200) });

/** Website customer sign-in with mobile number and password. */
export const POST = api({ public: true }, async (ctx) => {
  const result = await shopSignIn(await ctx.body(body), ctx.client);
  const res = NextResponse.json({ ok: true, data: { account: result.account } }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.set(SHOP_COOKIE, result.token, shopCookieOptions(result.expiresAt));
  return res;
});
