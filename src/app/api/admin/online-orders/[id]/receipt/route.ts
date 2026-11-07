import { api } from "@/server/http";
import { getPaymentReceiptForStaff } from "@/server/services/online-receipt";
import { renderPaymentReceiptPdf } from "@/server/pdf/payment-receipt";

/** The customer's payment receipt for an online order, for staff to print or save (not a tax invoice). */
export const GET = api({ permission: ["orders.view", "payments.verify"] }, async ({ actor, params, query }) => {
  const data = await getPaymentReceiptForStaff(actor, params.id);
  const pdf = await renderPaymentReceiptPdf(data);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${query.get("download") === "1" ? "attachment" : "inline"}; filename="Payment-receipt-${data.orderNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
});
