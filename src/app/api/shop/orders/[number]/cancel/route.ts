import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { cancelMyOrder } from "@/server/services/online-orders";

const body = z.object({ reason: z.string().trim().max(200).optional().nullable() });

/** The customer cancels: an unpaid order closes; a paid one (not yet confirmed by the shop) is refunded in full. */
export const POST = shopApi(async (ctx) => cancelMyOrder(ctx.account, ctx.params.number, ctx.client, await ctx.body(body)));
