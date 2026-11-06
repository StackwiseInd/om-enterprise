import { z } from "zod";
import { api } from "@/server/http";
import { setOnlineOrderStatus } from "@/server/services/online-orders";

const body = z.object({ status: z.enum(["ready", "collected", "cancelled"]), reason: z.string().trim().max(300).optional().nullable() });

export const POST = api({ permission: "orders.manage" }, async (ctx) => setOnlineOrderStatus(ctx.actor, ctx.params.id, await ctx.body(body)));
