/**
 * A stand-in for PhonePe's Standard Checkout v2 API, shaped like the documented responses. Used by
 * the integration tests (as a fetch function) and by scripts/fake-phonepe.ts (as an HTTP server)
 * for browser runs. Tests drive it by setting what each merchant order "did" at PhonePe.
 */

export interface FakeOrder {
  merchantOrderId: string;
  orderId: string;
  amount: number;
  state: "PENDING" | "COMPLETED" | "FAILED";
  paidAmount?: number;
  paymentMode?: string;
  errorCode?: string;
  redirectUrl: string;
  utr: string;
}
export interface FakeRefund {
  merchantRefundId: string;
  originalMerchantOrderId: string;
  amount: number;
  state: "PENDING" | "CONFIRMED" | "COMPLETED" | "FAILED";
}

export class FakePhonePe {
  orders = new Map<string, FakeOrder>();
  refunds = new Map<string, FakeRefund>();
  calls: { method: string; path: string; body: unknown }[] = [];
  /** When set, every call answers with this HTTP status (PhonePe down). */
  down: number | null = null;
  /** When set, refund requests are refused with this status. */
  refuseRefunds: number | null = null;
  private seq = 0;

  constructor(private readonly payPageBase = "https://mercury-uat.phonepe.com/transact/uat_v2") {}

  pay(merchantOrderId: string, opts: { paymentMode?: string; amount?: number } = {}) {
    const o = this.orders.get(merchantOrderId);
    if (!o) throw new Error(`fake PhonePe: no order ${merchantOrderId}`);
    Object.assign(o, { state: "COMPLETED", paymentMode: opts.paymentMode ?? "UPI_INTENT", paidAmount: opts.amount ?? o.amount });
  }
  fail(merchantOrderId: string, errorCode = "INVALID_MPIN") {
    const o = this.orders.get(merchantOrderId);
    if (!o) throw new Error(`fake PhonePe: no order ${merchantOrderId}`);
    Object.assign(o, { state: "FAILED", errorCode });
  }
  settleRefund(merchantRefundId: string, state: FakeRefund["state"] = "COMPLETED") {
    const r = this.refunds.get(merchantRefundId);
    if (!r) throw new Error(`fake PhonePe: no refund ${merchantRefundId}`);
    r.state = state;
  }

  /** Answer one request: path is everything after the base URL (e.g. "/checkout/v2/pay"). */
  handle(method: string, path: string, rawBody: string | null): { status: number; body: unknown } {
    const body = rawBody ? safeJson(rawBody) : null;
    this.calls.push({ method, path, body });
    if (this.down) return { status: this.down, body: { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong" } };
    const p = path.split("?")[0];

    if (method === "POST" && p === "/v1/oauth/token") {
      return { status: 200, body: { access_token: `fake-token-${++this.seq}`, token_type: "O-Bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, issued_at: Math.floor(Date.now() / 1000) } };
    }
    if (method === "POST" && p === "/checkout/v2/pay") {
      const b = body as { merchantOrderId: string; amount: number; expireAfter: number; paymentFlow: { merchantUrls: { redirectUrl: string } } };
      if (this.orders.has(b.merchantOrderId)) return { status: 400, body: { code: "BAD_REQUEST", message: "Duplicate merchantOrderId" } };
      const orderId = `OMO${Date.now()}${++this.seq}`;
      const o: FakeOrder = { merchantOrderId: b.merchantOrderId, orderId, amount: b.amount, state: "PENDING", redirectUrl: b.paymentFlow.merchantUrls.redirectUrl, utr: `4${String(Date.now()).slice(-8)}${String(this.seq % 1000).padStart(3, "0")}` };
      this.orders.set(b.merchantOrderId, o);
      return { status: 200, body: { orderId, state: "PENDING", expireAt: Date.now() + b.expireAfter * 1000, redirectUrl: `${this.payPageBase}?token=${encodeURIComponent(b.merchantOrderId)}` } };
    }
    const status = p.match(/^\/checkout\/v2\/order\/([^/]+)\/status$/);
    if (method === "GET" && status) {
      const o = this.orders.get(decodeURIComponent(status[1]));
      if (!o) return { status: 404, body: { code: "ORDER_NOT_FOUND", message: "No order" } };
      const paid = o.paidAmount ?? o.amount;
      return {
        status: 200,
        body: {
          orderId: o.orderId,
          state: o.state,
          amount: o.state === "COMPLETED" ? paid : o.amount,
          expireAt: Date.now() + 600_000,
          ...(o.state === "FAILED" ? { errorCode: o.errorCode, detailedErrorCode: "ZM", errorContext: { description: "Wrong MPIN was entered" } } : {}),
          paymentDetails:
            o.state === "PENDING"
              ? []
              : [
                  {
                    transactionId: `OM${o.orderId.slice(3)}`,
                    paymentMode: o.paymentMode ?? "UPI_INTENT",
                    timestamp: Date.now(),
                    amount: paid,
                    state: o.state,
                    ...(o.state === "FAILED" ? { errorCode: o.errorCode } : {}),
                    rail: { type: "UPI", utr: o.utr, upiTransactionId: "upi12313", vpa: "12****78@ybl" },
                  },
                ],
        },
      };
    }
    if (method === "POST" && p === "/payments/v2/refund") {
      if (this.refuseRefunds) return { status: this.refuseRefunds, body: { code: "BAD_REQUEST", message: "Refund not allowed" } };
      const b = body as { merchantRefundId: string; originalMerchantOrderId: string; amount: number };
      const o = this.orders.get(b.originalMerchantOrderId);
      if (!o || o.state !== "COMPLETED") return { status: 400, body: { code: "BAD_REQUEST", message: "Order not completed" } };
      if (this.refunds.has(b.merchantRefundId)) return { status: 400, body: { code: "BAD_REQUEST", message: "Duplicate merchantRefundId" } };
      this.refunds.set(b.merchantRefundId, { ...b, state: "PENDING" });
      return { status: 200, body: { refundId: `OMR${Date.now()}${++this.seq}`, amount: b.amount, state: "PENDING" } };
    }
    const refund = p.match(/^\/payments\/v2\/refund\/([^/]+)\/status$/);
    if (method === "GET" && refund) {
      const r = this.refunds.get(decodeURIComponent(refund[1]));
      if (!r) return { status: 404, body: { code: "NOT_FOUND", message: "No refund" } };
      return { status: 200, body: { merchantId: "M1", merchantRefundId: r.merchantRefundId, originalMerchantOrderId: r.originalMerchantOrderId, amount: r.amount, state: r.state, paymentDetails: [] } };
    }
    return { status: 404, body: { code: "NOT_FOUND", message: `No route ${method} ${p}` } };
  }

  /** A fetch function for PhonePeClient, for a client whose base URL is `base`. */
  fetchFor(base: string) {
    return async (url: string, init: RequestInit) => {
      if (!url.startsWith(base)) throw new Error(`fake PhonePe: unexpected host ${url}`);
      const r = this.handle(init.method ?? "GET", url.slice(base.length), typeof init.body === "string" ? init.body : null);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
    };
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
