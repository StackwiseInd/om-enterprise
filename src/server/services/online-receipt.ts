import "server-only";
import { createHmac } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { onlineOrderLines, onlineOrders, type OrderCustomerDetails } from "@/server/db/schema";
import { requirePermission, type Actor } from "@/server/auth/actor";
import { conflict, notFound } from "@/server/errors";
import { getSettings } from "@/server/settings";
import type { ShopAccount } from "@/server/services/shop-auth";
import type { ReceiptData } from "@/server/pdf/payment-receipt";
import { addressLines } from "@/components/public/site-data";
import { getProfileById, orderDetailsFrom } from "@/server/services/shop-profile";
import { EMPTY_PROFILE } from "@/lib/shop-profile";

/**
 * The customer's proof of an online payment: a receipt for the shop counter, NOT a tax invoice. It lists what
 * was bought and what was paid, and carries a short code only this server can produce for that order and
 * payment, so a receipt can't be made up: staff compare the code with the one on the order's page.
 */

/** XXXX-XXXX, from a secret key the server alone holds, the order number, the payment id and the amount. */
export function receiptCodeFor(o: { orderNumber: string; gatewayTransactionId: string | null; utr: string | null; total: string }): string {
  const key = process.env.APP_SECRET ?? "dev-secret";
  const h = createHmac("sha256", key).update(`receipt|${o.orderNumber}|${o.gatewayTransactionId ?? o.utr ?? ""}|${o.total}`).digest("hex").slice(0, 8).toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4)}`;
}

const PAID: string[] = ["paid", "confirmed", "ready", "collected"];
export const hasReceipt = (status: string) => PAID.includes(status);

type Order = typeof onlineOrders.$inferSelect;

async function buildReceipt(o: Order): Promise<ReceiptData> {
  if (!hasReceipt(o.status)) throw conflict("A receipt is available once the payment is confirmed.");
  const db = getDb();
  const lines = await db.select().from(onlineOrderLines).where(eq(onlineOrderLines.orderId, o.id));
  const business = await getSettings("business");
  const details = await customerDetailsOf(o);
  return {
    shop: { name: business.name, addressLines: addressLines(business), phone: business.phone || null, gstin: business.gstin || null },
    orderNumber: o.orderNumber,
    status: o.status as ReceiptData["status"],
    paidAt: o.verifiedAt,
    collectedAt: o.collectedAt,
    customer: { name: o.customerName, mobile: o.mobile, email: o.customerEmail, ...details },
    lines: lines.map((l) => ({ name: l.productName, variant: l.variantName ?? "", quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
    subtotal: o.subtotal,
    discount: o.discount,
    total: o.total,
    couponCode: o.couponCode,
    payment: { gateway: o.paymentMethod === "razorpay" ? "Razorpay" : "UPI (checked by the shop)", method: o.gatewayPaymentMode, paymentId: o.gatewayTransactionId, utr: o.gatewayUtr ?? o.utr },
    code: receiptCodeFor(o),
  };
}

/**
 * The customer's details as the order keeps them (from when it was placed). Orders placed before profiles
 * existed have none, so the account's current profile fills in.
 */
export async function customerDetailsOf(o: Pick<Order, "customerDetails" | "accountId">): Promise<OrderCustomerDetails> {
  if (o.customerDetails) return o.customerDetails;
  return orderDetailsFrom(await getProfileById(o.accountId).catch(() => EMPTY_PROFILE));
}

/** The receipt for one of the customer's own paid orders. */
export async function getPaymentReceipt(account: ShopAccount, orderNumber: string): Promise<ReceiptData> {
  const [o] = await getDb().select().from(onlineOrders).where(and(eq(onlineOrders.orderNumber, orderNumber), eq(onlineOrders.accountId, account.id), isNull(onlineOrders.deletedAt)));
  if (!o) throw notFound("Order");
  return buildReceipt(o);
}

/** The same receipt for staff, to print or save from the order's page. */
export async function getPaymentReceiptForStaff(actor: Actor, id: string): Promise<ReceiptData> {
  requirePermission(actor, ["orders.view", "payments.verify"]);
  const [o] = await getDb().select().from(onlineOrders).where(and(eq(onlineOrders.id, id), isNull(onlineOrders.deletedAt)));
  if (!o) throw notFound("Online order");
  return buildReceipt(o);
}
