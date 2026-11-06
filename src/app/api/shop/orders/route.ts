import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { listMyOrders, placeOnlineOrder } from "@/server/services/online-orders";
import { qtyStr, uuid } from "@/lib/validation";

const body = z.object({
  items: z.array(z.object({ variantId: uuid, quantity: qtyStr })).min(1).max(50),
  couponCode: z.string().trim().max(40).optional().nullable(),
});

export const GET = shopApi(async (ctx) => listMyOrders(ctx.account));

/** Place the order at server prices; the discount code (if any) is reserved for it. */
export const POST = shopApi(async (ctx) => placeOnlineOrder(ctx.account, await ctx.body(body), ctx.client));
