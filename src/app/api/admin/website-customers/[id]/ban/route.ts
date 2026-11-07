import { z } from "zod";
import { api } from "@/server/http";
import { banShopCustomer } from "@/server/services/shop-moderation";

const body = z.object({ reason: z.string().trim().max(300), blockMobile: z.boolean().optional(), blockEmail: z.boolean().optional(), blockAltMobile: z.boolean().optional() });
export const POST = api({ permission: "customers.ban" }, async (ctx) => banShopCustomer(ctx.actor, ctx.params.id, await ctx.body(body)));
