import { api } from "@/server/http";
import { checkGatewayNow } from "@/server/services/online-payments";

/** Ask PhonePe for this order's payment status now. */
export const POST = api({ permission: ["orders.view", "payments.verify"] }, async (ctx) => checkGatewayNow(ctx.actor, ctx.params.id));
