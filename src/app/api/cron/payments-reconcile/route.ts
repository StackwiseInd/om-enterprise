import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { reconcileOpenOrders } from "@/server/services/online-payments";

/**
 * Safety net for online payments: re-check every Razorpay order still waiting on an answer (and refunds in
 * progress). Pages and webhooks already do this as it happens; the scheduler (vercel.json) runs it once a day
 * on the Hobby plan, and can run it every few minutes on Pro. Needs `Authorization: Bearer <CRON_SECRET>`.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret ?? ""}`);
  if (!secret || given.length !== want.length || !timingSafeEqual(given, want)) {
    return NextResponse.json({ ok: false, error: { code: "UNAUTHENTICATED", message: "Not allowed" } }, { status: 401 });
  }
  try {
    await reconcileOpenOrders(100);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Payment reconcile failed:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
