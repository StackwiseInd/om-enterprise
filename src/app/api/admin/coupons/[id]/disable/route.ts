import { api } from "@/server/http";
import { disableCoupons } from "@/server/services/coupons";

export const POST = api({ permission: "discounts.configure" }, async (ctx) => disableCoupons(ctx.actor, { couponId: ctx.params.id }));
