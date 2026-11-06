import { shopApi } from "@/server/shop-api";
import { payMyOrder } from "@/server/services/online-orders";

/** Back to PhonePe for this order: the open payment page, or a new attempt after a failed one. */
export const POST = shopApi(async (ctx) => payMyOrder(ctx.account, ctx.params.number, ctx.client));
