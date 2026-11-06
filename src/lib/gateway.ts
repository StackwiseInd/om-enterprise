/** Online payment method names (safe to import in client components: no secrets, no server code). */

/** "razorpay": paid in Razorpay's checkout, confirmed by its own API. "upi_manual": the shop's UPI QR + UTR, checked by staff. */
export type PaymentMethod = "razorpay" | "upi_manual";

export const GATEWAY_NAME = "Razorpay";

export const isGatewayMethod = (m: string | null | undefined): m is "razorpay" => m === "razorpay";

/** "Razorpay" for a gateway order, else a neutral phrase. */
export const gatewayName = (m: string | null | undefined) => (isGatewayMethod(m) ? GATEWAY_NAME : "the payment gateway");

/** A payment method as Razorpay names it, in words a customer knows. */
const MODES: Record<string, string> = {
  UPI: "UPI",
  CARD: "card",
  NETBANKING: "net banking",
  WALLET: "wallet",
  EMI: "EMI",
  PAYLATER: "pay later",
  CARDLESS_EMI: "cardless EMI",
  BANK_TRANSFER: "bank transfer",
};
export function paymentModeLabel(m: string) {
  return MODES[m.toUpperCase()] ?? m.toLowerCase().replace(/_/g, " ");
}
