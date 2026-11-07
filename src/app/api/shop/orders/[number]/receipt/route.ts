import { shopApi } from "@/server/shop-api";
import { getPaymentReceipt } from "@/server/services/online-receipt";
import { renderPaymentReceiptPdf } from "@/server/pdf/payment-receipt";

/**
 * The customer's payment receipt for one of their own paid orders (a PDF to show at the counter; not a tax
 * invoice). ?download=1 saves it, otherwise it opens in the browser.
 */
export const GET = shopApi(async (ctx) => {
  const data = await getPaymentReceipt(ctx.account, ctx.params.number);
  const pdf = await renderPaymentReceiptPdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${ctx.query.get("download") === "1" ? "attachment" : "inline"}; filename="Payment-receipt-${data.orderNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});
