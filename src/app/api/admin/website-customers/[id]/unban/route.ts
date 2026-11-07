import { z } from "zod";
import { api } from "@/server/http";
import { unbanShopCustomer } from "@/server/services/shop-moderation";

const body = z.object({ reason: z.string().trim().max(300).optional().nullable(), unblock: z.boolean().optional() });
export const POST = api({ permission: "customers.ban" }, async (ctx) => unbanShopCustomer(ctx.actor, ctx.params.id, await ctx.body(body)));
