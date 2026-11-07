import { z } from "zod";
import { api } from "@/server/http";
import { addToBlocklist } from "@/server/services/shop-moderation";

const body = z.object({ kind: z.enum(["mobile", "email"]), value: z.string().trim().min(3).max(200), reason: z.string().trim().max(300) });
/** Block a mobile number or email address from the website (any account using it is banned). */
export const POST = api({ permission: "customers.ban" }, async (ctx) => addToBlocklist(ctx.actor, await ctx.body(body)));
