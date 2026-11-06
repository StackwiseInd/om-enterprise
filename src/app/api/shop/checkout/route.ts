import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { previewCheckout } from "@/server/services/online-orders";
import { qtyStr, uuid } from "@/lib/validation";

const body = z.object({
  items: z.array(z.object({ variantId: uuid, quantity: qtyStr })).min(1).max(50),
  couponCode: z.string().trim().max(40).optional().nullable(),
});

/** Price the cart for checkout and check a discount code (nothing is reserved yet). */
export const POST = shopApi(async (ctx) => previewCheckout(ctx.account, await ctx.body(body), ctx.client));
