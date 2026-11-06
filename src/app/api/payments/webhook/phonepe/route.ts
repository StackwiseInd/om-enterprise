import type { NextRequest } from "next/server";
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
    const result = await handlePhonePeWebhook(raw, req.headers.get("authorization"));
    return Response.json(result, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[phonepe webhook]", err);
    return Response.json({ ok: false }, { status: 200 });
  }
}
