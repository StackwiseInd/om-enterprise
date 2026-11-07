import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { SHOP_COOKIE } from "@/server/auth/shop-session";
import { changeMyPassword } from "@/server/services/shop-profile";

const body = z.object({ current: z.string().min(1).max(200), next: z.string().max(200) });

/** The customer changes their password; this device stays signed in, the others are signed out. */
export const POST = shopApi(async (ctx) => {
  await changeMyPassword(ctx.account, await ctx.body(body), ctx.req.cookies.get(SHOP_COOKIE)?.value, ctx.client);
  return { ok: true };
});
