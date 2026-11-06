import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RazorpayClient, razorpayConfigFromEnv, toPaise, verifyCheckoutSignature, verifyRazorpayWebhookSignature, type RazorpayConfig } from "@/server/payments/razorpay";
import { FakeRazorpay } from "../support/fake-razorpay";

const fake = () => new FakeRazorpay();
const clientFor = (f: FakeRazorpay) => new RazorpayClient({ keyId: f.keyId, keySecret: f.keySecret, testMode: true } satisfies RazorpayConfig, f.fetchFor());

describe("Razorpay client (Orders API)", () => {
  it("creates an order in paise with INR and a receipt, authenticating with the key pair", async () => {
    const f = fake();
    const r = await clientFor(f).createOrder({ receipt: "OL000123-1", amountPaise: 89000, note: "OM ENTERPRISE order OL000123" });
    expect(r.orderId).toMatch(/^order_/);
    const call = f.calls[0];
    expect(call).toMatchObject({ method: "POST", path: "/v1/orders", body: { amount: 89000, currency: "INR", receipt: "OL000123-1" } });
    expect(call.headers.Authorization).toBe(`Basic ${Buffer.from(`${f.keyId}:${f.keySecret}`).toString("base64")}`);
  });

  it("refuses receipts and amounts Razorpay would reject, before calling it", async () => {
    const f = fake();
    const c = clientFor(f);
    await expect(c.createOrder({ receipt: "OL 1/2", amountPaise: 1000 })).rejects.toThrow(/receipt/);
    await expect(c.createOrder({ receipt: "OL1", amountPaise: 99 })).rejects.toThrow(/100 paise/);
    expect(f.calls).toHaveLength(0);
  });

  it("turns a Razorpay error into a clear error, and a bad key into a 401", async () => {
    const f = fake();
    const bad = new RazorpayClient({ keyId: f.keyId, keySecret: "wrong", testMode: true }, f.fetchFor());
    await expect(bad.createOrder({ receipt: "OL1", amountPaise: 1000 })).rejects.toMatchObject({ name: "RazorpayError", status: 401, message: "Authentication failed" });
    f.down = 503;
    await expect(clientFor(f).createOrder({ receipt: "OL1", amountPaise: 1000 })).rejects.toMatchObject({ status: 503 });
  });

  it("reads status: created and attempted are PENDING; paid is COMPLETED only with a captured payment", async () => {
    const f = fake();
    const c = clientFor(f);
    const { orderId } = await c.createOrder({ receipt: "OL9-1", amountPaise: 5000 });
    expect(await c.orderStatus({ receipt: "OL9-1", gatewayOrderId: orderId })).toMatchObject({ state: "PENDING", transactionId: null });
    f.failAttempt(orderId);
    expect(await c.orderStatus({ receipt: "OL9-1", gatewayOrderId: orderId })).toMatchObject({ state: "PENDING" });
    const p = f.pay(orderId, { method: "upi" });
    expect(await c.orderStatus({ receipt: "OL9-1", gatewayOrderId: orderId })).toMatchObject({ state: "COMPLETED", amountPaise: 5000, transactionId: p.id, paymentMode: "UPI", utr: p.rrn });
  });

  it("does not call an uncaptured payment paid, and finds an order by receipt when its id wasn't saved", async () => {
    const f = fake();
    const c = clientFor(f);
    const { orderId } = await c.createOrder({ receipt: "OL7-1", amountPaise: 5000 });
    f.pay(orderId, { status: "authorized" });
    expect((await c.orderStatus({ receipt: "OL7-1" })).state).toBe("PENDING"); // looked up by receipt
    expect(f.calls.some((x) => x.path === "/v1/orders?receipt=OL7-1")).toBe(true);
    await expect(c.orderStatus({ receipt: "OL-NOPE" })).rejects.toMatchObject({ status: 404 });
  });

  it("refunds against the payment with an idempotency key, and reads the refund's status", async () => {
    const f = fake();
    const c = clientFor(f);
    const { orderId } = await c.createOrder({ receipt: "OL5-1", amountPaise: 5000 });
    const p = f.pay(orderId);
    const r = await c.refund({ merchantRefundId: "OL5-R1", paymentId: p.id, amountPaise: 5000, note: "OL5" });
    expect(r.state).toBe("PENDING");
    expect(f.calls.at(-1)!.headers["X-Refund-Idempotency"]).toBe("omr-OL5-R1");
    // The same refund sent again returns the same refund, not a second one.
    expect((await c.refund({ merchantRefundId: "OL5-R1", paymentId: p.id, amountPaise: 5000 })).refundId).toBe(r.refundId);
    expect(f.refunds.size).toBe(1);
    f.settleRefund(r.refundId!);
    expect(await c.refundStatus(r.refundId)).toMatchObject({ state: "COMPLETED", amountPaise: 5000 });
    await expect(c.refund({ merchantRefundId: "OL5-R2", paymentId: null, amountPaise: 100 })).rejects.toThrow(/payment id/);
  });
});

describe("signatures", () => {
  const secret = "key-secret-123456";
  const sign = (orderId: string, paymentId: string) => createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");

  it("accepts HMAC-SHA256(order_id|payment_id) from the key secret and nothing else", () => {
    const ok = { orderId: "order_ABC123", paymentId: "pay_XYZ789", signature: sign("order_ABC123", "pay_XYZ789") };
    expect(verifyCheckoutSignature(ok, secret)).toBe(true);
    expect(verifyCheckoutSignature({ ...ok, signature: ok.signature.toUpperCase() }, secret)).toBe(true);
    expect(verifyCheckoutSignature({ ...ok, paymentId: "pay_OTHER" }, secret)).toBe(false); // someone else's payment
    expect(verifyCheckoutSignature({ ...ok, orderId: "order_OTHER" }, secret)).toBe(false);
    expect(verifyCheckoutSignature(ok, "another-secret")).toBe(false);
    expect(verifyCheckoutSignature({ ...ok, signature: "abc" }, secret)).toBe(false);
    expect(verifyCheckoutSignature({ ...ok, signature: "" }, secret)).toBe(false);
    expect(verifyCheckoutSignature({ ...ok, orderId: "" }, secret)).toBe(false);
    expect(verifyCheckoutSignature(ok, "")).toBe(false);
  });

  it("accepts a webhook only when X-Razorpay-Signature is HMAC-SHA256 of the raw body", () => {
    const raw = JSON.stringify({ event: "order.paid", payload: {} });
    const good = FakeRazorpay.signWebhook(raw, "whsec");
    expect(verifyRazorpayWebhookSignature(raw, good, "whsec")).toBe(true);
    expect(verifyRazorpayWebhookSignature(raw + " ", good, "whsec")).toBe(false); // body changed by even a space
    expect(verifyRazorpayWebhookSignature(raw, good, "other")).toBe(false);
    expect(verifyRazorpayWebhookSignature(raw, null, "whsec")).toBe(false);
    expect(verifyRazorpayWebhookSignature(raw, "not-hex", "whsec")).toBe(false);
  });
});

describe("configuration and money", () => {
  it("needs both keys, and spots test keys", () => {
    const prev = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
    try {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
      expect(razorpayConfigFromEnv()).toBeNull();
      process.env.RAZORPAY_KEY_ID = "rzp_test_abc";
      expect(razorpayConfigFromEnv()).toBeNull();
      process.env.RAZORPAY_KEY_SECRET = "s";
      expect(razorpayConfigFromEnv()).toMatchObject({ keyId: "rzp_test_abc", testMode: true });
      process.env.RAZORPAY_KEY_ID = "rzp_live_abc";
      expect(razorpayConfigFromEnv()?.testMode).toBe(false);
    } finally {
      if (prev.id === undefined) delete process.env.RAZORPAY_KEY_ID;
      else process.env.RAZORPAY_KEY_ID = prev.id;
      if (prev.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET;
      else process.env.RAZORPAY_KEY_SECRET = prev.secret;
    }
  });

  it("converts rupee strings to paise exactly", () => {
    expect(toPaise("890.00")).toBe(89000);
    expect(toPaise("0.05")).toBe(5);
    expect(toPaise("1234.5")).toBe(123450);
    expect(toPaise("100000")).toBe(10000000);
  });
});
