import { z } from "zod";
import { shopApi } from "@/server/shop-api";
import { verifyCheckoutPayment } from "@/server/services/online-payments";
import { customerAuditActor } from "@/server/services/shop-auth";

const body = z.object({
  razorpay_payment_id: z.string().regex(/^pay_[A-Za-z0-9]{6,40}$/, "Missing payment id"),
  razorpay_order_id: z.string().regex(/^order_[A-Za-z0-9]{6,40}$/, "Missing order id"),
  razorpay_signature: z.string().regex(/^[0-9a-f]{64}$/i, "Missing signature"),
});

/**
 * checkout.js's result for this customer's order. The signature is checked (a mismatch is a 400 and changes
 * nothing); a good one only makes the server ask Razorpay, which is what marks the order paid.
 */
export const POST = shopApi(async (ctx) => {
  const b = await ctx.body(body);
  return verifyCheckoutPayment(
    ctx.account.id,
    ctx.params.number,
    { orderId: b.razorpay_order_id, paymentId: b.razorpay_payment_id, signature: b.razorpay_signature },
    customerAuditActor(ctx.account, ctx.client),
  );
});
