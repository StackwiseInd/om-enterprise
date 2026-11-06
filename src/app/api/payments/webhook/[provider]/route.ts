import type { NextRequest } from "next/server";
import { clientInfoFromHeaders } from "@/server/auth/session";
import { enforceRateLimit, hashIp } from "@/server/rate-limit";
import { handleGatewayWebhook } from "@/server/services/payments";

/**
 * Payment gateway webhooks. Authenticated by the provider's HMAC signature over the RAW body
 * (never re-serialised). Idempotent: each provider event id is processed at most once.
 */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/payments/webhook/[provider]">) {
  const { provider } = await ctx.params;
  const raw = await req.text();
  if (raw.length > 512 * 1024) return new Response("too large", { status: 413 });
  try {
    // The gateway sends a handful of callbacks per payment; this only stops floods from one address.
    await enforceRateLimit(`webhook:${provider}:${hashIp(clientInfoFromHeaders(req.headers).ip)}`, 300, 60);
    const { outcome, status } = await handleGatewayWebhook(provider, raw, req.headers);
    return Response.json({ outcome }, { status });
  } catch (err) {
    if ((err as { code?: string }).code === "RATE_LIMITED") return Response.json({ outcome: "rate_limited" }, { status: 429 });
    console.error("[webhook]", provider, err);
    // 5xx makes the provider retry later; processing is idempotent.
    return Response.json({ outcome: "error" }, { status: 500 });
  }
}
