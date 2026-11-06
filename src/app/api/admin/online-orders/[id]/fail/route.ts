import { z } from "zod";
import { api } from "@/server/http";
import { failOnlinePayment } from "@/server/services/online-orders";

const body = z.object({ reason: z.string().trim().min(1).max(300) });

export const POST = api({ permission: "payments.verify" }, async (ctx) => failOnlinePayment(ctx.actor, ctx.params.id, await ctx.body(body)));
