import { Suspense } from "react";
import { MessageCircle, Phone } from "lucide-react";
import { requirePageActor } from "@/server/auth/session";
import { gatewayName, isGatewayMethod } from "@/lib/gateway";
import { can } from "@/server/auth/actor";
import { getOnlineOrder } from "@/server/services/online-orders";
import { whatsappLink } from "@/lib/india";
import { formatQty } from "@/lib/money";
import { ONLINE_ORDER_STATUS } from "@/lib/online-order-status";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, PageSkeleton } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DateTime, Money } from "@/components/ui/money";
import { OnlineOrderActions } from "@/components/dashboard/ops/online-order-actions";
import { loadOr404 } from "@/components/dashboard/ops/guard";
import { BackLink } from "@/components/dashboard/back-link";
import { TitleStamps } from "@/components/dashboard/title-stamps";
import { tdNum, tdText, th, thNum } from "@/components/dashboard/table";

export const metadata = { title: "Online order" };

export default function OnlineOrderPage({ params }: PageProps<"/dashboard/online-orders/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-navy-100 py-2.5 text-sm last:border-b-0">
      <dt className="text-navy-500">{label}</dt>
      <dd className="text-right text-navy-950">{children}</dd>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor(["orders.view", "payments.verify"]);
  const { id } = await params;
  const { order: o, lines, history, verifiedByName, handledByName, receiptCode } = await loadOr404(getOnlineOrder(actor, id));
  const paidOnline = ["paid", "ready", "collected"].includes(o.status);
  const st = ONLINE_ORDER_STATUS[o.status];

  return (
    <div className="space-y-6">
      <BackLink href="/dashboard/online-orders">All online orders</BackLink>
      <PageHeader
        eyebrow="Online order · collect at store"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular text-[0.72em] font-semibold tracking-tight">{o.orderNumber}</span>
            <TitleStamps>
              <Badge tone={st.tone}>{st.staff}</Badge>
            </TitleStamps>
          </span>
        }
        description={
          <>
            Placed <DateTime value={o.createdAt} /> by {o.customerName}
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          {paidOnline && (
            <Card>
              <CardHeader
                title="Proof of purchase"
                description="What to show if anyone asks: this customer paid online for these items, and whether they have taken them from the shop."
                actions={
                  <a href={`/api/admin/online-orders/${o.id}/receipt`} target="_blank" rel="noopener noreferrer" className={buttonClass("outline", "sm")}>
                    Print the payment receipt
                  </a>
                }
              />
              <CardBody>
                <dl>
                  <Row label="Paid online">
                    <Money value={o.total} className="font-semibold" /> {isGatewayMethod(o.paymentMethod) ? `through ${gatewayName(o.paymentMethod)}` : "by UPI"}
                    {o.verifiedAt ? <span className="text-navy-500"> · <DateTime value={o.verifiedAt} /></span> : null}
                  </Row>
                  <Row label="Customer">{o.customerName} · <span className="tabular">{o.mobile}</span></Row>
                  <Row label="Items">{lines.length} {lines.length === 1 ? "line" : "lines"} (listed below)</Row>
                  {receiptCode && (
                    <Row label="Receipt code">
                      <span className="tabular font-semibold tracking-wide">{receiptCode}</span>
                      <span className="block text-xs text-navy-500">The customer&apos;s receipt shows this same code.</span>
                    </Row>
                  )}
                  <Row label="Handed over">
                    {o.collectedAt ? (
                      <>
                        <span className="font-semibold text-emerald-800">Yes</span> · <DateTime value={o.collectedAt} />
                        {handledByName ? <> by {handledByName}</> : null}
                      </>
                    ) : (
                      <span className="text-amber-800">Not collected yet</span>
                    )}
                  </Row>
                  {o.collectNote && <Row label="Remarks">{o.collectNote}</Row>}
                </dl>
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Payment" description={isGatewayMethod(o.paymentMethod) ? `${gatewayName(o.paymentMethod)}: confirmed by ${gatewayName(o.paymentMethod)}'s own status API` : `UPI QR to ${o.upiVpa}, exact amount in the QR; checked by staff`} />
            <CardBody className="grid gap-6 md:grid-cols-2">
              <dl>
                <Row label="Items">{<Money value={o.subtotal} />}</Row>
                {o.couponCode && <Row label={`Discount (${o.couponCode})`}>− <Money value={o.discount} /></Row>}
                <Row label="To pay">
                  <Money value={o.total} className="text-base font-semibold" />
                </Row>
                {isGatewayMethod(o.paymentMethod) ? (
                  <>
                    <Row label={`${gatewayName(o.paymentMethod)} id`}>{o.gatewayMerchantOrderId ? <span className="tabular">{o.gatewayMerchantOrderId}{o.gatewayOrderId ? ` · ${o.gatewayOrderId}` : ""}</span> : "—"}</Row>
                    <Row label={`${gatewayName(o.paymentMethod)} status`}>{o.gatewayState ?? "—"}{o.gatewayCheckedAt ? <span className="text-navy-500"> · checked <DateTime value={o.gatewayCheckedAt} /></span> : null}</Row>
                    {o.gatewayTransactionId && <Row label="Transaction">{<span className="tabular">{o.gatewayTransactionId}</span>}{o.gatewayPaymentMode ? ` · ${o.gatewayPaymentMode}` : ""}</Row>}
                    {o.gatewayUtr && <Row label="UTR">{<span className="tabular font-semibold">{o.gatewayUtr}</span>}</Row>}
                    {o.refundMerchantId && (
                      <Row label="Refund">
                        <span className="tabular">{o.refundMerchantId}</span> · {o.refundState ?? "—"}
                        {o.refundedAt ? <> · <DateTime value={o.refundedAt} /></> : null}
                      </Row>
                    )}
                  </>
                ) : (
                  <>
                    <Row label="UTR">{o.utr ? <span className="tabular font-semibold">{o.utr}</span> : "—"}</Row>
                    <Row label="UTR sent">{o.utrSubmittedAt ? <DateTime value={o.utrSubmittedAt} /> : "—"}</Row>
                  </>
                )}
                {o.verifiedAt && (
                  <Row label="Verified">
                    <DateTime value={o.verifiedAt} /> by {verifiedByName ?? (isGatewayMethod(o.paymentMethod) ? gatewayName(o.paymentMethod) : "—")}
                  </Row>
                )}
                {o.verificationNote && <Row label="Note">{o.verificationNote}</Row>}
                {o.failureReason && <Row label={isGatewayMethod(o.paymentMethod) ? "Failed" : "Not found"}>{o.failureReason}</Row>}
                {o.cancelReason && <Row label="Cancelled">{o.cancelReason}</Row>}
              </dl>
              <OnlineOrderActions
                id={o.id}
                status={o.status}
                total={o.total}
                utr={o.utr ?? o.gatewayUtr}
                orderNumber={o.orderNumber}
                canVerify={can(actor, "payments.verify")}
                canManage={can(actor, "orders.manage")}
                gateway={isGatewayMethod(o.paymentMethod)}
                gatewayLabel={gatewayName(o.paymentMethod)}
                canRefund={can(actor, "payments.refund")}
                refundState={o.refundState}
                receiptCode={receiptCode}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Items" description={isGatewayMethod(o.paymentMethod) ? `Make the GST bill at the counter when the customer collects; record the payment as received online by ${gatewayName(o.paymentMethod)} with this payment ID.` : "Make the GST bill at the counter when the customer collects; record the UPI payment there with this UTR."} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr>
                    <th className={th}>Item</th>
                    <th className={thNum}>Qty</th>
                    <th className={thNum}>Unit price</th>
                    <th className={thNum}>Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className={tdText}>
                        <div className="font-medium">{l.productName}</div>
                        <div className="mt-0.5 text-xs text-navy-500">
                          {l.variantName ? `${l.variantName} · ` : ""}
                          <span className="tabular">{l.sku}</span>
                        </div>
                      </td>
                      <td className={tdNum}>
                        {formatQty(l.quantity)} <span className="font-sans text-xs text-navy-500">{l.unit.toLowerCase()}</span>
                      </td>
                      <td className={tdNum}><Money value={l.unitPrice} /></td>
                      <td className={`${tdNum} font-semibold`}><Money value={l.lineTotal} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title={o.customerName} description="Website account" />
            <CardBody className="flex flex-wrap gap-2">
              <a href={`tel:+91${o.mobile}`} className={buttonClass("outline")}>
                <Phone className="h-4 w-4" /> <span className="tabular">{o.mobile}</span>
              </a>
              <a href={whatsappLink(o.mobile, `Namaste ${o.customerName}, about your online order ${o.orderNumber} at OM ENTERPRISE.`)} target="_blank" rel="noopener noreferrer" className={buttonClass("success")}>
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" description="Every step, from the audit log." />
            <CardBody>
              <ol className="space-y-3">
                {history.map((h) => (
                  <li key={h.id} className="text-sm">
                    <div className="text-navy-950">{h.summary}</div>
                    <div className="mt-0.5 text-xs text-navy-500">
                      <DateTime value={h.at} /> · {h.actorLabel}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
