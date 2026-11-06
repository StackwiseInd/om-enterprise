import { z } from "zod";
import { api } from "@/server/http";
import { refundOnlineOrder } from "@/server/services/online-payments";

const body = z.object({ reason: z.string().trim().max(300).default("") });

/** Cancel a Razorpay-paid order and refund it in full (or retry a failed refund). */
export const POST = api({ permission: "payments.refund" }, async (ctx) => refundOnlineOrder(ctx.actor, ctx.params.id, await ctx.body(body)));
