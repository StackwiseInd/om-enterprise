import { NextResponse } from "next/server";
import { api } from "@/server/http";
import { shopSignOut } from "@/server/services/shop-auth";
import { SHOP_COOKIE } from "@/server/auth/shop-session";

export const POST = api({ public: true }, async (ctx) => {
  await shopSignOut(ctx.req.cookies.get(SHOP_COOKIE)?.value);
  const res = NextResponse.json({ ok: true, data: null }, { headers: { "Cache-Control": "no-store" } });
  res.cookies.delete(SHOP_COOKIE);
  return res;
});
