import QRCode from "qrcode";
import { shopApi } from "@/server/shop-api";
import { getMyOrder } from "@/server/services/online-orders";
import { notFound } from "@/server/errors";

/** SVG UPI QR with the order's exact amount, while it is waiting for payment. */
export const GET = shopApi(async (ctx) => {
  const { order } = await getMyOrder(ctx.account, ctx.params.number);
  if (!order.qrPayload) throw notFound("QR");
  const svg = await QRCode.toString(order.qrPayload, { type: "svg", errorCorrectionLevel: "M", margin: 2, color: { dark: "#0D1B30", light: "#FFFFFF" } });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" } });
});
