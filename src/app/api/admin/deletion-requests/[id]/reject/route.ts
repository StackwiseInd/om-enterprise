import { z } from "zod";
import { api } from "@/server/http";
import { rejectDeletionRequest } from "@/server/services/shop-moderation";

const body = z.object({ note: z.string().trim().max(300) });
export const POST = api({ permission: "customers.ban" }, async (ctx) => {
  await rejectDeletionRequest(ctx.actor, ctx.params.id, await ctx.body(body));
  return { ok: true };
});
