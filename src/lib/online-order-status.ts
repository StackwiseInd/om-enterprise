import type { OnlineOrderStatus } from "@/server/db/schema";

/** How an online order's state is named for the customer and for staff, and its badge tone. */
export const ONLINE_ORDER_STATUS: Record<OnlineOrderStatus, { customer: string; staff: string; tone: "neutral" | "green" | "amber" | "red" }> = {
  awaiting_payment: { customer: "Waiting for payment", staff: "Waiting for payment", tone: "neutral" },
  payment_submitted: { customer: "Checking payment", staff: "Payment to check", tone: "amber" },
  paid: { customer: "Order placed", staff: "Paid · to confirm", tone: "green" },
  confirmed: { customer: "Confirmed by the shop", staff: "Confirmed", tone: "green" },
  payment_failed: { customer: "Payment not found", staff: "Payment not found", tone: "red" },
  ready: { customer: "Ready for pickup", staff: "Ready for pickup", tone: "green" },
  collected: { customer: "Collected", staff: "Collected", tone: "neutral" },
  cancelled: { customer: "Cancelled", staff: "Cancelled", tone: "neutral" },
  expired: { customer: "Expired (not paid)", staff: "Expired", tone: "neutral" },
  refunding: { customer: "Refund in progress", staff: "Refunding", tone: "amber" },
  refunded: { customer: "Refunded", staff: "Refunded", tone: "neutral" },
};
