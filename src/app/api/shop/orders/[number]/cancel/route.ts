import { shopApi } from "@/server/shop-api";
import { cancelMyOrder } from "@/server/services/online-orders";

export const POST = shopApi(async (ctx) => cancelMyOrder(ctx.account, ctx.params.number, ctx.client));
