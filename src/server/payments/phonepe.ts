import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * PhonePe Payment Gateway, Standard Checkout v2 (developer.phonepe.com → Payment Gateway → Website
 * integration). Plain fetch, no SDK.
 *
 * - Authorization: POST {identity}/v1/oauth/token (form: client_id, client_version, client_secret,
 *   grant_type=client_credentials) → access_token + expires_at (epoch seconds), sent as
 *   "Authorization: O-Bearer <token>". The token is reused until shortly before it expires.
 * - Pay: POST {pg}/checkout/v2/pay (amount in paise, expireAfter 300–3600 s, paymentFlow.type
 *   PG_CHECKOUT, merchantUrls.redirectUrl) → orderId, state, expireAt, redirectUrl (used as is).
 * - Status: GET {pg}/checkout/v2/order/{merchantOrderId}/status → root `state` PENDING | COMPLETED |
 *   FAILED is the only payment truth; paymentDetails carry the attempt (mode, transaction id, UTR).
 * - Refund: POST {pg}/payments/v2/refund; status: GET {pg}/payments/v2/refund/{merchantRefundId}/status
 *   (PENDING | CONFIRMED | COMPLETED | FAILED).
 * - Webhook: Authorization header = SHA256(username:password) configured in the dashboard.
 *
 * Responses are read loosely (PhonePe adds fields over time and asks merchants not to deserialize
 * strictly).
 */

export type PhonePeEnv = "sandbox" | "production";

export interface PhonePeConfig {
  env: PhonePeEnv;
  clientId: string;
  clientSecret: string;
  clientVersion: string;
  webhookUsername: string | null;
  webhookPassword: string | null;
}

const HOSTS: Record<PhonePeEnv, { token: string; pg: string }> = {
  sandbox: { token: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token", pg: "https://api-preprod.phonepe.com/apis/pg-sandbox" },
  production: { token: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token", pg: "https://api.phonepe.com/apis/pg" },
};

/** Base URLs can be pointed elsewhere only for local testing against a stand-in server. */
function hosts(env: PhonePeEnv) {
  const override = process.env.PHONEPE_TEST_BASE_URL;
  if (override && process.env.NODE_ENV !== "production") return { token: `${override}/v1/oauth/token`, pg: override };
  if (override && process.env.PHONEPE_ALLOW_TEST_BASE_URL === "true") return { token: `${override}/v1/oauth/token`, pg: override };
  return HOSTS[env];
}

export function phonePeConfigFromEnv(): PhonePeConfig | null {
  const clientId = process.env.PHONEPE_CLIENT_ID?.trim();
  const clientSecret = process.env.PHONEPE_CLIENT_SECRET?.trim();
  const clientVersion = process.env.PHONEPE_CLIENT_VERSION?.trim();
  if (!clientId || !clientSecret || !clientVersion) return null;
  const env: PhonePeEnv = process.env.PHONEPE_ENV === "production" ? "production" : "sandbox";
  return {
    env,
    clientId,
    clientSecret,
    clientVersion,
    webhookUsername: process.env.PHONEPE_WEBHOOK_USERNAME?.trim() || null,
    webhookPassword: process.env.PHONEPE_WEBHOOK_PASSWORD?.trim() || null,
  };
}

export class PhonePeError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "PhonePeError";
  }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Token cache per credential set: reused until 5 minutes before it expires. */
const tokens = new Map<string, { token: string; expiresAt: number }>();
export function __clearPhonePeTokenCache() {
  tokens.clear();
}

const TIMEOUT_MS = 10_000;

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return { message: text.slice(0, 200) };
  }
}

export class PhonePeClient {
  constructor(
    private readonly cfg: PhonePeConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  get env() {
    return this.cfg.env;
  }

  private async token(force = false): Promise<string> {
    const key = `${this.cfg.env}:${this.cfg.clientId}:${this.cfg.clientVersion}`;
    const cached = tokens.get(key);
    if (!force && cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
    const res = await this.fetchImpl(hosts(this.cfg.env).token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_version: this.cfg.clientVersion,
        client_secret: this.cfg.clientSecret,
        grant_type: "client_credentials",
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await readJson(res);
    const token = typeof body.access_token === "string" ? body.access_token : null;
    if (!res.ok || !token) throw new PhonePeError(`PhonePe sign-in failed (${res.status})`, res.status, typeof body.code === "string" ? body.code : null);
    // expires_at is epoch seconds; fall back to 30 minutes if it is missing.
    const exp = Number(body.expires_at);
    tokens.set(key, { token, expiresAt: Number.isFinite(exp) && exp > 0 ? exp * 1000 : Date.now() + 30 * 60_000 });
    return token;
  }

  /** Authorised call; one retry with a fresh token if PhonePe says the token is no longer valid. */
  private async call(method: "GET" | "POST", path: string, body?: unknown): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.token(attempt > 0);
      const res = await this.fetchImpl(`${hosts(this.cfg.env).pg}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `O-Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const json = await readJson(res);
      if (res.status === 401 && attempt === 0) continue;
      if (!res.ok) {
        throw new PhonePeError(typeof json.message === "string" ? json.message : `PhonePe request failed (${res.status})`, res.status, typeof json.code === "string" ? json.code : null);
      }
      return json;
    }
    throw new PhonePeError("PhonePe rejected the credentials", 401, "UNAUTHORIZED");
  }

  async createCheckout(input: { merchantOrderId: string; amountPaise: number; expireAfterSeconds: number; redirectUrl: string; mobile?: string | null; note?: string }) {
    if (!/^[A-Za-z0-9_-]{1,63}$/.test(input.merchantOrderId)) throw new Error("merchantOrderId must be 1–63 letters, digits, _ or -");
    if (!Number.isInteger(input.amountPaise) || input.amountPaise < 100) throw new Error("amount must be at least 100 paise");
    const body: Record<string, unknown> = {
      merchantOrderId: input.merchantOrderId,
      amount: input.amountPaise,
      expireAfter: Math.min(3600, Math.max(300, Math.round(input.expireAfterSeconds))),
      paymentFlow: { type: "PG_CHECKOUT", ...(input.note ? { message: input.note.slice(0, 100) } : {}), merchantUrls: { redirectUrl: input.redirectUrl } },
    };
    if (input.mobile) body.prefillUserLoginDetails = { phoneNumber: input.mobile };
    const r = await this.call("POST", "/checkout/v2/pay", body);
    const redirectUrl = typeof r.redirectUrl === "string" ? r.redirectUrl : null;
    if (!redirectUrl) throw new PhonePeError("PhonePe did not return a payment page", null, typeof r.code === "string" ? r.code : null);
    return {
      orderId: typeof r.orderId === "string" ? r.orderId : null,
      state: typeof r.state === "string" ? r.state : "PENDING",
      expireAt: Number(r.expireAt) > 0 ? new Date(Number(r.expireAt)) : null,
      redirectUrl,
    };
  }

  async orderStatus(merchantOrderId: string): Promise<PhonePeOrderStatus> {
    const r = await this.call("GET", `/checkout/v2/order/${encodeURIComponent(merchantOrderId)}/status?details=false&errorContext=true`);
    return normalizeOrderStatus(r);
  }

  async refund(input: { merchantRefundId: string; originalMerchantOrderId: string; amountPaise: number }) {
    const r = await this.call("POST", "/payments/v2/refund", {
      merchantRefundId: input.merchantRefundId,
      originalMerchantOrderId: input.originalMerchantOrderId,
      amount: input.amountPaise,
    });
    return { refundId: typeof r.refundId === "string" ? r.refundId : null, state: typeof r.state === "string" ? r.state : "PENDING" };
  }

  async refundStatus(merchantRefundId: string) {
    const r = await this.call("GET", `/payments/v2/refund/${encodeURIComponent(merchantRefundId)}/status`);
    return { state: typeof r.state === "string" ? r.state : "PENDING", amountPaise: Number(r.amount) || null, refundId: typeof r.refundId === "string" ? r.refundId : null };
  }
}

export interface PhonePeOrderStatus {
  state: "PENDING" | "COMPLETED" | "FAILED" | "UNKNOWN";
  orderId: string | null;
  amountPaise: number | null;
  transactionId: string | null;
  paymentMode: string | null;
  utr: string | null;
  errorCode: string | null;
  errorDescription: string | null;
}

/** Read the status response loosely; the root `state` is the payment truth. */
export function normalizeOrderStatus(r: Record<string, unknown>): PhonePeOrderStatus {
  const state = r.state === "PENDING" || r.state === "COMPLETED" || r.state === "FAILED" ? r.state : "UNKNOWN";
  const details = Array.isArray(r.paymentDetails) ? (r.paymentDetails as Record<string, unknown>[]) : [];
  const attempt = details.find((d) => d?.state === "COMPLETED") ?? details[details.length - 1] ?? null;
  const rails: Record<string, unknown>[] = [];
  if (attempt?.rail && typeof attempt.rail === "object") rails.push(attempt.rail as Record<string, unknown>);
  if (Array.isArray(attempt?.splitInstruments)) for (const s of attempt.splitInstruments as Record<string, unknown>[]) if (s?.rail && typeof s.rail === "object") rails.push(s.rail as Record<string, unknown>);
  const utr = rails.map((x) => x.utr).find((u): u is string => typeof u === "string" && u.length > 0) ?? null;
  const ctx = r.errorContext && typeof r.errorContext === "object" ? (r.errorContext as Record<string, unknown>) : null;
  return {
    state,
    orderId: typeof r.orderId === "string" ? r.orderId : null,
    amountPaise: Number.isFinite(Number(r.amount)) ? Number(r.amount) : null,
    transactionId: typeof attempt?.transactionId === "string" ? attempt.transactionId : null,
    paymentMode: typeof attempt?.paymentMode === "string" ? attempt.paymentMode : null,
    utr,
    errorCode: typeof r.errorCode === "string" ? r.errorCode : typeof attempt?.errorCode === "string" ? attempt.errorCode : null,
    errorDescription: typeof ctx?.description === "string" ? ctx.description : null,
  };
}

/** The webhook's Authorization header must equal SHA256(username:password) (hex). */
export function verifyPhonePeWebhookAuth(header: string | null, cfg: Pick<PhonePeConfig, "webhookUsername" | "webhookPassword">): boolean {
  if (!header || !cfg.webhookUsername || !cfg.webhookPassword) return false;
  const expected = createHash("sha256").update(`${cfg.webhookUsername}:${cfg.webhookPassword}`).digest("hex");
  const got = header.trim().replace(/^SHA256\s+/i, "").toLowerCase();
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** ₹ string with 2 decimals → integer paise. */
export function toPaise(rupees: string): number {
  const [i, f = ""] = rupees.split(".");
  return Number(i) * 100 + Number((f + "00").slice(0, 2));
}
