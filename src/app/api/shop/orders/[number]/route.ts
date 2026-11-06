import { shopApi } from "@/server/shop-api";
import { getMyOrder } from "@/server/services/online-orders";

/** The customer's own order (the order page polls this while the shop checks the payment). */
export const GET = shopApi(async (ctx) => getMyOrder(ctx.account, ctx.params.number));
