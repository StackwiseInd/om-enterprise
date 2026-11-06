import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { __clearPhonePeTokenCache, normalizeOrderStatus, PhonePeClient, toPaise, verifyPhonePeWebhookAuth, type PhonePeConfig } from "@/server/payments/phonepe";

const cfg: PhonePeConfig = { env: "sandbox", clientId: "CID", clientSecret: "SECRET", clientVersion: "1", webhookUsername: "hookuser", webhookPassword: "hookpass" };

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (url: string, init: RequestInit) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = handler(url, init);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  return { fn, calls };
}
const tokenBody = (t = "tok-1") => ({ access_token: t, token_type: "O-Bearer", expires_at: Math.floor(Date.now() / 1000) + 3600 });

beforeEach(() => __clearPhonePeTokenCache());

describe("PhonePe client (Standard Checkout v2)", () => {
  it("gets a token with the documented form fields and reuses it until it nears expiry", async () => {
    const f = fakeFetch((url) => (url.endsWith("/oauth/token") ? { body: tokenBody() } : { body: { orderId: "OMO1", state: "PENDING", expireAt: Date.now() + 600000, redirectUrl: "https://mercury-uat.phonepe.com/transact/x" } }));
    const c = new PhonePeClient(cfg, f.fn);
    await c.createCheckout({ merchantOrderId: "OL000001-1", amountPaise: 89000, expireAfterSeconds: 1800, redirectUrl: "https://shop.example/my-orders/OL000001?from=phonepe" });
    await c.createCheckout({ merchantOrderId: "OL000002-1", amountPaise: 1000, expireAfterSeconds: 1800, redirectUrl: "https://shop.example/x" });
    const tokenCalls = f.calls.filter((c) => c.url.endsWith("/oauth/token"));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].url).toBe("https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token");
    expect((tokenCalls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(String(tokenCalls[0].init.body)))).toEqual({ client_id: "CID", client_version: "1", client_secret: "SECRET", grant_type: "client_credentials" });
  });

  it("creates a checkout with amount in paise, PG_CHECKOUT and the redirect URL, sending O-Bearer", async () => {
    const f = fakeFetch((url) => (url.endsWith("/oauth/token") ? { body: tokenBody("abc") } : { body: { orderId: "OMO9", state: "PENDING", expireAt: 1793900000000, redirectUrl: "https://mercury-uat.phonepe.com/transact/uat_v2?token=t" } }));
    const r = await new PhonePeClient(cfg, f.fn).createCheckout({ merchantOrderId: "OL000123-2", amountPaise: 89000, expireAfterSeconds: 99999, redirectUrl: "https://shop.example/r", mobile: "9825012345" });
    const pay = f.calls.find((c) => c.url.endsWith("/checkout/v2/pay"))!;
    expect(pay.url).toBe("https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay");
    expect((pay.init.headers as Record<string, string>).Authorization).toBe("O-Bearer abc");
    expect(JSON.parse(String(pay.init.body))).toMatchObject({
      merchantOrderId: "OL000123-2",
      amount: 89000,
      expireAfter: 3600, // clamped to PhonePe's maximum
      paymentFlow: { type: "PG_CHECKOUT", merchantUrls: { redirectUrl: "https://shop.example/r" } },
      prefillUserLoginDetails: { phoneNumber: "9825012345" },
    });
    expect(r).toMatchObject({ orderId: "OMO9", state: "PENDING", redirectUrl: "https://mercury-uat.phonepe.com/transact/uat_v2?token=t" });
  });

  it("refuses ids and amounts PhonePe would reject", async () => {
    const c = new PhonePeClient(cfg, fakeFetch(() => ({ body: tokenBody() })).fn);
    await expect(c.createCheckout({ merchantOrderId: "OL 1/2", amountPaise: 1000, expireAfterSeconds: 900, redirectUrl: "x" })).rejects.toThrow(/merchantOrderId/);
    await expect(c.createCheckout({ merchantOrderId: "OL1", amountPaise: 99, expireAfterSeconds: 900, redirectUrl: "x" })).rejects.toThrow(/100 paise/);
  });

  it("gets a fresh token once when PhonePe answers 401", async () => {
    let tokens = 0;
    let first = true;
    const f = fakeFetch((url) => {
      if (url.endsWith("/oauth/token")) return { body: tokenBody(`t${++tokens}`) };
      if (first) {
        first = false;
        return { status: 401, body: { code: "UNAUTHORIZED" } };
      }
      return { body: { orderId: "O", state: "PENDING", amount: 1000, paymentDetails: [] } };
    });
    const s = await new PhonePeClient(cfg, f.fn).orderStatus("OL1-1");
    expect(s.state).toBe("PENDING");
    expect(tokens).toBe(2);
    const statusCall = f.calls.filter((c) => c.url.includes("/status")).pop()!;
    expect(statusCall.url).toBe("https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order/OL1-1/status?details=false&errorContext=true");
    expect((statusCall.init.headers as Record<string, string>).Authorization).toBe("O-Bearer t2");
  });

  it("uses the production hosts in production", async () => {
    const f = fakeFetch((url) => (url.endsWith("/oauth/token") ? { body: tokenBody() } : { body: { refundId: "OMR1", state: "PENDING" } }));
    await new PhonePeClient({ ...cfg, env: "production" }, f.fn).refund({ merchantRefundId: "OL1-R1", originalMerchantOrderId: "OL1-1", amountPaise: 5000 });
    expect(f.calls[0].url).toBe("https://api.phonepe.com/apis/identity-manager/v1/oauth/token");
    expect(f.calls[1].url).toBe("https://api.phonepe.com/apis/pg/payments/v2/refund");
    expect(JSON.parse(String(f.calls[1].init.body))).toEqual({ merchantRefundId: "OL1-R1", originalMerchantOrderId: "OL1-1", amount: 5000 });
  });
});

describe("reading PhonePe's order status", () => {
  it("takes the root state and finds the UTR in splitInstruments", () => {
    const s = normalizeOrderStatus({
      orderId: "OMO2407021511185686967711",
      state: "COMPLETED",
      amount: 1000,
      paymentDetails: [
        {
          transactionId: "OM2407021515097451914211",
          paymentMode: "UPI_INTENT",
          amount: 1000,
          state: "COMPLETED",
          rail: { type: "UPI", upiTransactionId: "upi12313", vpa: "12****78@ybl" },
          splitInstruments: [{ rail: { type: "UPI", utr: "455069731511" }, amount: 1000 }],
        },
      ],
      someNewField: { ignored: true },
    });
    expect(s).toMatchObject({ state: "COMPLETED", amountPaise: 1000, transactionId: "OM2407021515097451914211", paymentMode: "UPI_INTENT", utr: "455069731511" });
  });

  it("reads card payments (no UTR) and failures with their reason", () => {
    expect(normalizeOrderStatus({ state: "COMPLETED", amount: 100, paymentDetails: [{ transactionId: "OM1", paymentMode: "CARD", state: "COMPLETED", rail: { type: "PG", authorizationCode: "088005" } }] })).toMatchObject({ paymentMode: "CARD", utr: null, transactionId: "OM1" });
    expect(
      normalizeOrderStatus({ state: "FAILED", amount: 200, errorCode: "INVALID_MPIN", paymentDetails: [{ state: "FAILED", errorCode: "INVALID_MPIN" }], errorContext: { description: "Wrong MPIN was entered" } }),
    ).toMatchObject({ state: "FAILED", errorCode: "INVALID_MPIN", errorDescription: "Wrong MPIN was entered" });
    expect(normalizeOrderStatus({ state: "SOMETHING_NEW" }).state).toBe("UNKNOWN");
  });
});

describe("webhook authorization", () => {
  const good = createHash("sha256").update("hookuser:hookpass").digest("hex");
  it("accepts SHA256(username:password) and nothing else", () => {
    expect(verifyPhonePeWebhookAuth(good, cfg)).toBe(true);
    expect(verifyPhonePeWebhookAuth(good.toUpperCase(), cfg)).toBe(true);
    expect(verifyPhonePeWebhookAuth(`SHA256 ${good}`, cfg)).toBe(true);
    expect(verifyPhonePeWebhookAuth(createHash("sha256").update("hookuser:wrong").digest("hex"), cfg)).toBe(false);
    expect(verifyPhonePeWebhookAuth(null, cfg)).toBe(false);
    expect(verifyPhonePeWebhookAuth(good, { webhookUsername: null, webhookPassword: null })).toBe(false);
  });
});

describe("toPaise", () => {
  it("converts rupee strings exactly", () => {
    expect(toPaise("890.00")).toBe(89000);
    expect(toPaise("0.05")).toBe(5);
    expect(toPaise("1234.5")).toBe(123450);
    expect(toPaise("100000")).toBe(10000000);
  });
});
