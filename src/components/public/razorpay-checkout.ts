"use client";
import { apiFetch, errorMessage } from "@/lib/api-client";

/**
 * Razorpay Standard Web Checkout in the browser:
 * 1. ask our server for the order's checkout parameters (it creates/reuses the Razorpay order; only the
 *    PUBLIC key id is sent here, never the secret),
 * 2. load checkout.js and open the payment modal,
 * 3. on success send razorpay_payment_id / razorpay_order_id / razorpay_signature to our server, which
 *    verifies the signature and asks Razorpay before marking anything paid.
 */

export interface CheckoutParams {
  keyId: string;
  orderId: string;
  amount: number;
  currency: "INR";
  name: string;
  description: string;
  prefill: { name: string; contact: string };
  timeoutSeconds: number;
}

interface RazorpaySuccess {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayFailure {
  error?: { description?: string; reason?: string };
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (r: RazorpayFailure) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";
let scriptLoading: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (typeof window !== "undefined" && window.Razorpay) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptLoading = null;
      s.remove();
      reject(new Error("We couldn't load the payment window. Check your internet connection and try again."));
    };
    document.head.appendChild(s);
  });
  return scriptLoading;
}

export type PaymentOutcome =
  | { kind: "paid"; status: string }
  /** The customer closed the payment window without paying. */
  | { kind: "dismissed"; lastFailure: string | null }
  | { kind: "failed"; message: string };

/** Open the payment modal for an order and resolve when it is settled one way or the other. */
export async function payOrder(orderNumber: string): Promise<PaymentOutcome> {
  let checkout: CheckoutParams;
  try {
    ({ checkout } = await apiFetch<{ checkout: CheckoutParams }>(`/api/shop/orders/${encodeURIComponent(orderNumber)}/pay`, { body: {} }));
    await loadCheckoutScript();
  } catch (err) {
    return { kind: "failed", message: errorMessage(err) };
  }
  const Razorpay = window.Razorpay;
  if (!Razorpay) return { kind: "failed", message: "We couldn't load the payment window. Please try again." };

  return new Promise<PaymentOutcome>((resolve) => {
    let settled = false;
    let lastFailure: string | null = null;
    const done = (o: PaymentOutcome) => {
      if (settled) return;
      settled = true;
      resolve(o);
    };
    const rzp = new Razorpay({
      key: checkout.keyId,
      order_id: checkout.orderId,
      amount: checkout.amount,
      currency: checkout.currency,
      name: checkout.name,
      description: checkout.description,
      prefill: checkout.prefill,
      theme: { color: "#0b1220" },
      timeout: checkout.timeoutSeconds,
      retry: { enabled: true },
      modal: { confirm_close: true, ondismiss: () => done({ kind: "dismissed", lastFailure }) },
      handler: async (resp: RazorpaySuccess) => {
        try {
          const r = await apiFetch<{ status: string }>(`/api/shop/orders/${encodeURIComponent(orderNumber)}/verify-payment`, {
            body: { razorpay_payment_id: resp.razorpay_payment_id, razorpay_order_id: resp.razorpay_order_id, razorpay_signature: resp.razorpay_signature },
          });
          done({ kind: "paid", status: r.status });
        } catch (err) {
          done({ kind: "failed", message: errorMessage(err) });
        }
      },
    });
    rzp.on("payment.failed", (r) => {
      lastFailure = r.error?.description ?? "The payment didn't go through.";
    });
    rzp.open();
  });
}
