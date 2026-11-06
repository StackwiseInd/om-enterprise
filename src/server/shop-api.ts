import "server-only";
import { api, type ApiContext } from "@/server/http";
import { AppError } from "@/server/errors";
import { shopAccountFromRequest } from "@/server/auth/shop-session";
import type { ShopAccount } from "@/server/services/shop-auth";

/** A public API route that needs a signed-in website customer. */
export function shopApi(handler: (ctx: ApiContext & { account: ShopAccount }) => Promise<unknown>) {
  return api({ public: true }, async (ctx) => {
    const account = await shopAccountFromRequest(ctx.req);
    if (!account) throw new AppError("UNAUTHENTICATED", "Please sign in to continue.");
    return handler({ ...ctx, account });
  });
}
