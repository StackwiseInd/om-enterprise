import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { connection, type NextRequest } from "next/server";
import { shopAccountFromToken, type ShopAccount } from "@/server/services/shop-auth";

const secure = process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIES !== "true";
/** The website customer's cookie; separate from the staff session cookie. */
export const SHOP_COOKIE = secure ? "__Host-om_shop" : "om_shop";

export function shopCookieOptions(expiresAt: Date) {
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires: expiresAt };
}

/** Signed-in website customer for Server Components (memoised per request). */
export const getShopAccount = cache(async (): Promise<ShopAccount | null> => {
  await connection();
  return shopAccountFromToken((await cookies()).get(SHOP_COOKIE)?.value);
});

export function shopAccountFromRequest(req: NextRequest): Promise<ShopAccount | null> {
  return shopAccountFromToken(req.cookies.get(SHOP_COOKIE)?.value);
}
