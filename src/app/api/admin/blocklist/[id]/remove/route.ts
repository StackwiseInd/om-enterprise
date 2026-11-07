import { z } from "zod";
import { api } from "@/server/http";
import { removeFromBlocklist } from "@/server/services/shop-moderation";

const body = z.object({ reason: z.string().trim().max(300) });
export const POST = api({ permission: "customers.ban" }, async (ctx) => {
  await removeFromBlocklist(ctx.actor, ctx.params.id, await ctx.body(body));
  return { ok: true };
});
