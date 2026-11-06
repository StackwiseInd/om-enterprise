import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Razorpay Standard Web Checkout, called with plain `fetch` (no SDK, so nothing extra to trust or update).
 *
 * - Auth: HTTP Basic, key id : key secret. The secret never leaves the server.
 * - Create the order: POST /v1/orders { amount (paise), currency, receipt, notes } → id (`order_…`).
 *   The browser opens checkout.js with that id and the PUBLIC key id.
 * - Customer pays in the modal; checkout.js hands back razorpay_payment_id, razorpay_order_id and
 *   razorpay_signature. The signature is HMAC-SHA256(order_id + "|" + payment_id, key secret) and is checked
 *   here. Even then an order is only marked paid after asking Razorpay itself (below).
 * - Status: GET /v1/orders/{id} → created | attempted | paid (+ amount, amount_paid), and
 *   GET /v1/orders/{id}/payments for the captured payment (method, bank reference / UTR).
 * - Refund: POST /v1/payments/{payment_id}/refund (header X-Refund-Idempotency makes a retry safe);
 *   status: GET /v1/refunds/{id} → pending | processed | failed.
 * - Webhook: X-Razorpay-Signature = hex(HMAC-SHA256(raw body, webhook secret)).
 *
 * Responses are read loosely: Razorpay adds fields over time.
 */

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  /** Test keys (rzp_test_…) move no real money. */
  testMode: boolean;
}

export function razorpayConfigFromEnv(): RazorpayConfig | null {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId || !keySecret) return null;
  return { keyId, keySecret, testMode: keyId.startsWith("rzp_test_") };
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "RazorpayError";
  }
}

const API = "https://api.razorpay.com";
const TIMEOUT_MS = 10_000;

/** The API host can be pointed elsewhere only for local testing against a stand-in server. */
function apiBase() {
  const override = process.env.RAZORPAY_TEST_BASE_URL;
  if (override && (process.env.NODE_ENV !== "production" || process.env.RAZORPAY_ALLOW_TEST_BASE_URL === "true")) return override.replace(/\/$/, "");
  return API;
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const j: unknown = await res.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const num = (v: unknown) => (v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);

/** The gateway's view of one order, in the terms the shop's order flow uses. */
export interface GatewayOrderStatus {
  /** COMPLETED only when Razorpay holds the money (order paid and its payment captured). */
  state: "PENDING" | "COMPLETED" | "UNKNOWN";
  orderId: string | null;
  amountPaise: number | null;
  /** The captured payment's id (`pay_…`), which refunds are made against. */
  transactionId: string | null;
  paymentMode: string | null;
  /** The bank reference of a UPI payment (rrn). */
  utr: string | null;
}

export class RazorpayClient {
  constructor(
    private readonly cfg: RazorpayConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get keyId() {
    return this.cfg.keyId;
  }

  private async call(method: "GET" | "POST", path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const res = await this.fetchImpl(`${apiBase()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString("base64")}`,
        ...extraHeaders,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const json = await readJson(res);
    if (!res.ok) {
      const err = obj(json.error);
      throw new RazorpayError(str(err?.description) ?? `Razorpay request failed (${res.status})`, res.status, str(err?.code));
    }
    return json;
  }

  /** Step 1: create the Razorpay order the checkout modal will pay. */
  async createOrder(input: { receipt: string; amountPaise: number; note?: string }) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(input.receipt)) throw new Error("receipt must be 1–40 letters, digits, _ or -");
    if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) throw new Error("amount must be at least 100 paise");
    const r = await this.call("POST", "/v1/orders", { amount: input.amountPaise, currency: "INR", receipt: input.receipt, notes: { order: (input.note ?? input.receipt).slice(0, 200) } });
    const orderId = str(r.id);
    if (!orderId) throw new RazorpayError("Razorpay did not return an order id", null, null);
    return { orderId, amountPaise: num(r.amount) ?? input.amountPaise };
  }

  async orderStatus(ref: { receipt: string; gatewayOrderId?: string | null }): Promise<GatewayOrderStatus> {
    let order: Record<string, unknown>;
    if (ref.gatewayOrderId) {
      order = await this.call("GET", `/v1/orders/${encodeURIComponent(ref.gatewayOrderId)}`);
    } else {
      // The order was created but its id wasn't saved: find it by our receipt.
      const list = await this.call("GET", `/v1/orders?receipt=${encodeURIComponent(ref.receipt)}`);
      const found = Array.isArray(list.items) ? (list.items as Record<string, unknown>[]).find((o) => o?.receipt === ref.receipt) : null;
      if (!found) throw new RazorpayError("Razorpay has no order for this receipt", 404, "NOT_FOUND");
      order = found;
    }
    const orderId = str(order.id);
    const base = { orderId, amountPaise: null as number | null, transactionId: null as string | null, paymentMode: null as string | null, utr: null as string | null };
    const status = str(order.status);
    if (status === "created" || status === "attempted") return { ...base, state: "PENDING", amountPaise: num(order.amount_paid) };
    if (status !== "paid" || !orderId) return { ...base, state: "UNKNOWN" };

    // "paid" means the order's amount has been captured; find that payment for its id, mode and UTR.
    const list = await this.call("GET", `/v1/orders/${encodeURIComponent(orderId)}/payments`);
    const pay = (Array.isArray(list.items) ? (list.items as Record<string, unknown>[]) : []).find((p) => p?.status === "captured") ?? null;
    if (!pay) return { ...base, state: "PENDING", amountPaise: num(order.amount_paid) }; // not captured (yet)
    const acquirer = obj(pay.acquirer_data);
    return {
      orderId,
      state: "COMPLETED",
      amountPaise: num(order.amount_paid) ?? num(pay.amount),
      transactionId: str(pay.id),
      paymentMode: str(pay.method)?.toUpperCase() ?? null,
      utr: str(acquirer?.rrn) ?? str(acquirer?.upi_transaction_id),
    };
  }

  async refund(input: { merchantRefundId: string; paymentId: string | null; amountPaise: number; note?: string }) {
    if (!input.paymentId || !/^pay_[A-Za-z0-9]+$/.test(input.paymentId)) throw new Error("no Razorpay payment id on this order");
    const r = await this.call(
      "POST",
      `/v1/payments/${encodeURIComponent(input.paymentId)}/refund`,
      { amount: input.amountPaise, speed: "normal", receipt: input.merchantRefundId.slice(0, 40), notes: { order: (input.note ?? "").slice(0, 200) } },
      // A retry of the same refund (network dropped before we saw the answer) can never refund twice.
      { "X-Refund-Idempotency": `omr-${input.merchantRefundId}`.slice(0, 64) },
    );
    return { refundId: str(r.id), state: refundState(r.status) };
  }

  async refundStatus(refundId: string | null) {
    if (!refundId) throw new RazorpayError("no Razorpay refund id", null, null);
    const r = await this.call("GET", `/v1/refunds/${encodeURIComponent(refundId)}`);
    return { state: refundState(r.status), amountPaise: num(r.amount), refundId: str(r.id) };
  }
}

/** Razorpay's refund status as PENDING | COMPLETED | FAILED. */
function refundState(s: unknown): "PENDING" | "COMPLETED" | "FAILED" {
  return s === "processed" ? "COMPLETED" : s === "failed" ? "FAILED" : "PENDING";
}

const hex = /^[0-9a-f]{64}$/i;

/** What checkout.js returns after a payment: HMAC-SHA256(order_id|payment_id, key secret), compared in constant time. */
export function verifyCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }, keySecret: string): boolean {
  if (!input.orderId || !input.paymentId || !keySecret || !hex.test(input.signature)) return false;
  const expected = createHmac("sha256", keySecret).update(`${input.orderId}|${input.paymentId}`, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(input.signature, "hex"));
}

/** X-Razorpay-Signature = hex(HMAC-SHA256(raw body, webhook secret)). */
export function verifyRazorpayWebhookSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !hex.test(signature) || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/** ₹ string with 2 decimals → integer paise. */
export function toPaise(rupees: string): number {
  const [i, f = ""] = rupees.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
}
