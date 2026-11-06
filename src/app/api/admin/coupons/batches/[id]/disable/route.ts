import { api } from "@/server/http";
import { disableCoupons } from "@/server/services/coupons";

/** Disable every unused code in a batch (reserved and used codes stay as they are). */
export const POST = api({ permission: "discounts.configure" }, async (ctx) => disableCoupons(ctx.actor, { batchId: ctx.params.id }));
