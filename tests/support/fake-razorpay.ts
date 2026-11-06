import { createHmac } from "node:crypto";

/**
 * A stand-in for Razorpay's Orders / Payments / Refunds API, shaped like the documented responses. Used by the
 * integration tests (as a fetch function) and by fake-razorpay-server.ts (as an HTTP server) for browser runs.
 * Tests drive it by saying what the customer did (`pay`, `failAttempt`) and how Razorpay settles refunds.
 */

export interface FakePayment {
  id: string;
  status: "captured" | "failed" | "authorized";
  method: string;
  amount: number;
  rrn: string;
}
export interface FakeOrder {
  id: string;
  receipt: string;
  amount: number;
  amount_paid: number;
  status: "created" | "attempted" | "paid";
  payments: FakePayment[];
}
export interface FakeRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: "pending" | "processed" | "failed";
  receipt: string | null;
}

export class FakeRazorpay {
  orders = new Map<string, FakeOrder>();
  refunds = new Map<string, FakeRefund>();
  calls: { method: string; path: string; body: unknown; headers: Record<string, string> }[] = [];
  /** When set, every call answers with this HTTP status (Razorpay down). */
  down: number | null = null;
  /** When set, refund requests are refused with this status. */
  refuseRefunds: number | null = null;
  private idempotent = new Map<string, FakeRefund>();
  private seq = 0;

  constructor(
    readonly keyId = "rzp_test_FAKEKEY123",
    readonly keySecret = "fake-secret-0123456789",
  ) {}

  private id(prefix: string) {
    return `${prefix}${Date.now().toString(36)}${String(++this.seq).padStart(4, "0")}`.slice(0, 20);
  }

  /** The customer pays the order in the checkout window. Returns the payment. */
  pay(orderId: string, opts: { method?: string; amount?: number; status?: FakePayment["status"] } = {}): FakePayment {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`fake Razorpay: no order ${orderId}`);
    const p: FakePayment = { id: this.id("pay_"), status: opts.status ?? "captured", method: opts.method ?? "upi", amount: opts.amount ?? o.amount, rrn: `4${String(Date.now()).slice(-8)}${String(this.seq).padStart(3, "0")}` };
    o.payments.push(p);
    if (p.status === "captured") {
      o.amount_paid = p.amount;
      o.status = "paid";
    } else o.status = "attempted";
    return p;
  }
  /** A try that failed in the window (wrong PIN, declined card): the order is "attempted", never paid. */
  failAttempt(orderId: string) {
    const o = this.orders.get(orderId);
    if (!o) throw new Error(`fake Razorpay: no order ${orderId}`);
    o.payments.push({ id: this.id("pay_"), status: "failed", method: "upi", amount: o.amount, rrn: "" });
    if (o.status === "created") o.status = "attempted";
  }
  settleRefund(id: string, status: FakeRefund["status"] = "processed") {
    const r = this.refunds.get(id);
    if (!r) throw new Error(`fake Razorpay: no refund ${id}`);
    r.status = status;
  }
  orderByReceipt(receipt: string) {
    return [...this.orders.values()].find((o) => o.receipt === receipt);
  }

  /** What checkout.js hands back after a payment: the signature our server must verify. */
  signCheckout(orderId: string, paymentId: string) {
    return createHmac("sha256", this.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
  }
  static signWebhook(rawBody: string, secret: string) {
    return createHmac("sha256", secret).update(rawBody).digest("hex");
  }

  /** Answer one request: `path` is everything after the host (e.g. "/v1/orders"). */
  handle(method: string, path: string, rawBody: string | null, headers: Record<string, string> = {}): { status: number; body: unknown } {
    const body = rawBody ? safeJson(rawBody) : null;
    this.calls.push({ method, path, body, headers });
    if (this.down) return { status: this.down, body: { error: { code: "SERVER_ERROR", description: "Something went wrong" } } };
    const auth = headers.authorization ?? headers.Authorization ?? "";
    if (auth !== `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`) return { status: 401, body: { error: { code: "BAD_REQUEST_ERROR", description: "Authentication failed" } } };
    const [p, query = ""] = path.split("?");
    const q = new URLSearchParams(query);

    if (method === "POST" && p === "/v1/orders") {
      const b = body as { amount: number; currency: string; receipt: string };
      if (!Number.isInteger(b.amount) || b.amount < 100) return { status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "The amount must be at least INR 1.00", field: "amount" } } };
      const o: FakeOrder = { id: this.id("order_"), receipt: b.receipt, amount: b.amount, amount_paid: 0, status: "created", payments: [] };
      this.orders.set(o.id, o);
      return { status: 200, body: this.orderJson(o) };
    }
    if (method === "GET" && p === "/v1/orders") {
      const items = [...this.orders.values()].filter((o) => !q.get("receipt") || o.receipt === q.get("receipt")).map((o) => this.orderJson(o));
      return { status: 200, body: { entity: "collection", count: items.length, items } };
    }
    const pays = p.match(/^\/v1\/orders\/([^/]+)\/payments$/);
    if (method === "GET" && pays) {
      const o = this.orders.get(decodeURIComponent(pays[1]));
      if (!o) return { status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } } };
      return { status: 200, body: { entity: "collection", count: o.payments.length, items: o.payments.map((x) => this.paymentJson(o, x)) } };
    }
    const one = p.match(/^\/v1\/orders\/([^/]+)$/);
    if (method === "GET" && one) {
      const o = this.orders.get(decodeURIComponent(one[1]));
      if (!o) return { status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } } };
      return { status: 200, body: this.orderJson(o) };
    }
    const refundPay = p.match(/^\/v1\/payments\/([^/]+)\/refund$/);
    if (method === "POST" && refundPay) {
      if (this.refuseRefunds) return { status: this.refuseRefunds, body: { error: { code: "BAD_REQUEST_ERROR", description: "Refund not allowed" } } };
      const key = headers["X-Refund-Idempotency"] ?? headers["x-refund-idempotency"];
      if (key && this.idempotent.has(key)) return { status: 200, body: this.refundJson(this.idempotent.get(key)!) };
      const payId = decodeURIComponent(refundPay[1]);
      const o = [...this.orders.values()].find((x) => x.payments.some((y) => y.id === payId && y.status === "captured"));
      const b = (body ?? {}) as { amount?: number; receipt?: string };
      if (!o) return { status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "The payment is not captured or does not exist" } } };
      const already = [...this.refunds.values()].filter((r) => r.payment_id === payId && r.status !== "failed").reduce((a, r) => a + r.amount, 0);
      const amount = b.amount ?? o.amount;
      if (already + amount > o.amount) return { status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "The refund amount provided is greater than the amount captured" } } };
      const r: FakeRefund = { id: this.id("rfnd_"), payment_id: payId, amount, status: "pending", receipt: b.receipt ?? null };
      this.refunds.set(r.id, r);
      if (key) this.idempotent.set(key, r);
      return { status: 200, body: this.refundJson(r) };
    }
    const refund = p.match(/^\/v1\/refunds\/([^/]+)$/);
    if (method === "GET" && refund) {
      const r = this.refunds.get(decodeURIComponent(refund[1]));
      if (!r) return { status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } } };
      return { status: 200, body: this.refundJson(r) };
    }
    return { status: 404, body: { error: { code: "BAD_REQUEST_ERROR", description: `No route ${method} ${p}` } } };
  }

  private orderJson(o: FakeOrder) {
    return { id: o.id, entity: "order", amount: o.amount, amount_paid: o.amount_paid, amount_due: o.amount - o.amount_paid, currency: "INR", receipt: o.receipt, status: o.status, attempts: o.payments.length, created_at: Math.floor(Date.now() / 1000) };
  }
  private paymentJson(o: FakeOrder, p: FakePayment) {
    return { id: p.id, entity: "payment", amount: p.amount, currency: "INR", status: p.status, order_id: o.id, method: p.method, captured: p.status === "captured", acquirer_data: { rrn: p.rrn || null }, ...(p.status === "failed" ? { error_code: "BAD_REQUEST_ERROR", error_description: "Payment processing failed because of incorrect PIN" } : {}) };
  }
  private refundJson(r: FakeRefund) {
    return { id: r.id, entity: "refund", amount: r.amount, currency: "INR", payment_id: r.payment_id, receipt: r.receipt, status: r.status, speed_processed: "normal", speed_requested: "normal" };
  }

  /** A fetch function for RazorpayClient. */
  fetchFor(base = "https://api.razorpay.com") {
    return async (url: string, init: RequestInit) => {
      if (!url.startsWith(base)) throw new Error(`fake Razorpay: unexpected host ${url}`);
      const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
      const r = this.handle(init.method ?? "GET", url.slice(base.length), typeof init.body === "string" ? init.body : null, headers);
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
    };
  }

  /** The webhook body Razorpay would send for a paid order. */
  orderPaidEvent(orderId: string) {
    const o = this.orders.get(orderId)!;
    const pay = o.payments.find((x) => x.status === "captured")!;
    return JSON.stringify({ entity: "event", event: "order.paid", payload: { order: { entity: this.orderJson(o) }, payment: { entity: this.paymentJson(o, pay) } } });
  }
  refundEvent(refundId: string, event: "refund.processed" | "refund.failed") {
    return JSON.stringify({ entity: "event", event, payload: { refund: { entity: this.refundJson(this.refunds.get(refundId)!) } } });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
