import { shopApi } from "@/server/shop-api";
import { payMyOrder } from "@/server/services/online-orders";

/** The customer wants to pay: the checkout window's parameters for this order (public key id only), or a new try after a failed one. */
export const POST = shopApi(async (ctx) => payMyOrder(ctx.account, ctx.params.number, ctx.client));
