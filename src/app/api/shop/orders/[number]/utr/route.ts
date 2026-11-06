import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { submitUtr } from "@/server/services/online-orders";

const body = z.object({ utr: z.string().trim().min(1).max(40) });

/** The customer sends the UPI transaction ID (UTR) after paying. */
export const POST = shopApi(async (ctx) => submitUtr(ctx.account, ctx.params.number, (await ctx.body(body)).utr, ctx.client));
