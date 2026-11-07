import { z } from "zod";
import { api } from "@/server/http";
import { setShopCustomerActive } from "@/server/services/shop-customers";

const body = z.object({ active: z.boolean(), reason: z.string().trim().max(300).optional().nullable() });

/** Disable or re-enable a website customer's account. */
export const POST = api({ permission: "customers.edit" }, async (ctx) => setShopCustomerActive(ctx.actor, ctx.params.id, await ctx.body(body)));
