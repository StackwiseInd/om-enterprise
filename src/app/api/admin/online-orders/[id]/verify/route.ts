import { z } from "zod";
import { api } from "@/server/http";
import { verifyOnlinePayment } from "@/server/services/online-orders";

const body = z.object({ note: z.string().trim().max(300).optional().nullable() });

/** Staff saw the exact amount arrive with the customer's UTR in the shop's bank/UPI app. */
export const POST = api({ permission: "payments.verify" }, async (ctx) => verifyOnlinePayment(ctx.actor, ctx.params.id, await ctx.body(body)));
