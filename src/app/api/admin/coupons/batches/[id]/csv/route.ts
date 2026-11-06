import { api } from "@/server/http";
import { getCouponBatch } from "@/server/services/coupons";

const cell = (v: string | null | undefined) => {
  const s = v ?? "";
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The batch's codes as CSV, to print or share one by one. */
export const GET = api({ permission: "discounts.configure" }, async (ctx) => {
  const { batch, codes } = await getCouponBatch(ctx.actor, ctx.params.id);
  const rows = [["Code", "Amount off", "Minimum order", "Valid until", "Status", "Order"], ...codes.map((c) => [c.code, batch.amountOff, batch.minOrder, batch.validUntil?.toISOString().slice(0, 10) ?? "", c.status, c.orderNumber ?? ""])];
  const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const name = batch.label.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "coupons";
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "no-store" } });
});
