import { z } from "zod";
import { api } from "@/server/http";
import { deleteShopAccount } from "@/server/services/shop-moderation";

// Confirmed with the staff member's delete phrase (checked in the service).
const body = z.object({ confirm: z.string().trim().min(1).max(100), reason: z.string().trim().max(300).optional().nullable(), requestId: z.string().uuid().optional().nullable(), block: z.boolean().optional() });
export const POST = api({ permission: "customers.ban" }, async (ctx) => deleteShopAccount(ctx.actor, ctx.params.id, await ctx.body(body)));
