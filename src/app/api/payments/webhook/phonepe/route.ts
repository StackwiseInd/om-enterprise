import type { NextRequest } from "next/server";
import { clientInfoFromHeaders } from "@/server/auth/session";
import { enforceRateLimit, hashIp } from "@/server/rate-limit";
import { handlePhonePeWebhook } from "@/server/services/online-payments";

/**
 * PhonePe Payment Gateway webhook (checkout.order.completed / failed, pg.refund.completed / failed).
 * The Authorization header is checked (SHA256 of the dashboard username:password) and the event is
 * logged, but an order changes only after this server asks PhonePe's Order Status API. Always answers
 * quickly with 200 so PhonePe doesn't time out; a missed update is picked up by the regular checks.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 256 * 1024) return new Response("too large", { status: 413 });
  try {
    // PhonePe sends a handful of callbacks per payment; this only stops floods from one address.
    await enforceRateLimit(`phonepe-webhook:${hashIp(clientInfoFromHeaders(req.headers).ip)}`, 300, 60);
    const result = await handlePhonePeWebhook(raw, req.headers.get("authorization"));
    return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[phonepe webhook]", err);
    // Over the rate limit: say so (PhonePe retries later). Anything else: still 200, the regular checks catch up.
    const limited = (err as { code?: string }).code === "RATE_LIMITED";
    return Response.json({ ok: false }, { status: limited ? 429 : 200 });
  }
}
