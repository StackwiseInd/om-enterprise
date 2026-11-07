import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { requestAccountDeletion, withdrawDeletionRequest } from "@/server/services/shop-moderation";

const body = z.object({ password: z.string().min(1).max(200), reason: z.string().trim().max(500).optional().nullable() });

/** The customer asks for their account to be deleted (their password confirms it). */
export const POST = shopApi(async (ctx) => {
  const r = await requestAccountDeletion(ctx.account, await ctx.body(body), ctx.client);
  return { requestedAt: r.requestedAt };
});

/** …or withdraws the request. */
export const DELETE = shopApi(async (ctx) => {
  await withdrawDeletionRequest(ctx.account, ctx.client);
  return { ok: true };
});
