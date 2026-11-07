import { z } from "zod";
import { api } from "@/server/http";
import { resetShopCustomerPassword } from "@/server/services/shop-customers";

const body = z.object({ password: z.string().min(1).max(200) });

/** Set a new password for a website customer who asked the shop (they are signed out everywhere). */
export const POST = api({ permission: "customers.edit" }, async (ctx) => resetShopCustomerPassword(ctx.actor, ctx.params.id, (await ctx.body(body)).password));
