"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, Clock3, Download, FileText, MessageCircle, Phone, Smartphone, Store, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { cn } from "@/components/ui/cn";
import { gatewayName, isGatewayMethod, paymentModeLabel, type PaymentMethod } from "@/lib/gateway";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { payOrder } from "./razorpay-checkout";
import { ShopMap } from "./shop-map";
import { formatPhone, whatsappLink } from "@/lib/india";
import { formatPrice } from "@/lib/money";
import type { OnlineOrderStatus } from "@/server/db/schema";

interface OrderData {
  order: {
    orderNumber: string;
    status: OnlineOrderStatus;
    subtotal: string;
    discount: string;
    total: string;
    couponCode: string | null;
    paymentMethod: PaymentMethod;
    upiVpa: string | null;
    qrPayload: string | null;
    canPayNow: boolean;
    gatewayPaymentMode: string | null;
    gatewayState: string | null;
    refundState: string | null;
    refundedAt: string | null;
    collectedAt: string | null;
    receiptCode: string | null;
    expiresAt: string;
    utr: string | null;
    utrSubmittedAt: string | null;
    verifiedAt: string | null;
    failureReason: string | null;
    cancelReason: string | null;
    createdAt: string;
  };
  lines: { id: string; productName: string; variantName: string | null; unit: string; quantity: string; unitPrice: string; lineTotal: string }[];
}

interface Shop {
  name: string;
  address: string[];
  mapUrl: string;
  directionsUrl: string;
  mapEmbedUrl: string;
  phone: string | null;
  whatsapp: string | null;
}

const time = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

function useCountdown(until: string, active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const left = Math.max(0, new Date(until).getTime() - now);
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  return { left, label: `${mm}:${String(ss).padStart(2, "0")}` };
}

export function OrderPayment({ initial, shop, autoPay = false }: { initial: OrderData; shop: Shop; autoPay?: boolean }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const o = data.order;
  const refresh = () => {
    apiFetch<OrderData>(`/api/shop/orders/${o.orderNumber}`).then(setData).catch(() => {});
  };

  // Keep the page current while the shop checks the payment (and to notice when time runs out).
  const gateway = isGatewayMethod(o.paymentMethod);
  const gw = gatewayName(o.paymentMethod);
  useEffect(() => {
    if (o.status !== "payment_submitted" && o.status !== "awaiting_payment" && o.status !== "refunding") return;
    // Gateway: the server asks the gateway on its check schedule; these polls just pick up the answer.
    const every = o.status === "refunding" ? 15000 : gateway ? 4000 : o.status === "payment_submitted" ? 8000 : 30000;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      apiFetch<OrderData>(`/api/shop/orders/${o.orderNumber}`).then(setData).catch(() => {});
    }, every);
    return () => clearInterval(t);
  }, [o.status, o.orderNumber, gateway]);

  const steps = gateway ? [`Pay on ${gw}`, "Payment confirmed", "Collect"] : ["Pay by UPI", "Send UTR", "Shop confirms", "Collect"];
  const step = gateway
    ? o.status === "awaiting_payment" || o.status === "payment_submitted" ? 0 : ["paid", "ready"].includes(o.status) ? 1 : o.status === "collected" ? 2 : -1
    : o.status === "awaiting_payment" ? 0 : o.status === "payment_submitted" ? 1 : ["paid", "ready"].includes(o.status) ? 2 : o.status === "collected" ? 3 : -1;
  const paidVia = gateway ? `on ${gw}${o.gatewayPaymentMode ? ` (${paymentModeLabel(o.gatewayPaymentMode)})` : ""}` : `by UPI (UTR ${o.utr})`;
  const wa = shop.whatsapp ? whatsappLink(shop.whatsapp, `Hello ${shop.name}, about my online order ${o.orderNumber}${o.utr ? ` (UTR ${o.utr})` : ""}.`) : null;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
      <section className="rounded-xl border border-navy-200 bg-white">
        {step >= 0 && (
          <ol className={cn("grid border-b border-navy-100 text-center text-[12px] sm:text-[13px]", steps.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
            {steps.map((s, i) => (
              <li key={s} className={cn("flex flex-col items-center gap-1.5 px-1 py-3.5", i === step ? "font-semibold text-navy-950" : i < step ? "text-emerald-800" : "text-navy-400")}>
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full border", i < step ? "border-emerald-600 bg-emerald-600 text-white" : i === step ? "border-navy-900 text-navy-950" : "border-navy-200")}>
                  {i < step ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </span>
                {s}
              </li>
            ))}
          </ol>
        )}
        <div className="p-5 sm:p-7">
          {o.status === "awaiting_payment" && !gateway && <PayNow data={data} onSubmitted={setData} onCancelled={() => router.refresh()} />}
          {o.status === "awaiting_payment" && gateway && <GatewayPay data={data} autoPay={autoPay} onCancelled={() => router.refresh()} onChanged={refresh} />}
          {o.status === "payment_submitted" && gateway && (
            <StatusBlock icon={<Clock3 className="h-6 w-6 text-amber-600" />} title="We're checking your payment">
              <p>{gw} reported a payment that we need to check by hand. The shop will confirm it shortly; this page updates by itself.</p>
            </StatusBlock>
          )}
          {o.status === "payment_submitted" && !gateway && (
            <StatusBlock icon={<Clock3 className="h-6 w-6 text-amber-600" />} title="We're checking your payment">
              <p>
                UTR <span className="tabular font-semibold text-navy-950">{o.utr}</span> sent {o.utrSubmittedAt ? time(o.utrSubmittedAt) : ""}. We match it with {formatPrice(o.total)} in the shop&apos;s bank account. During shop hours this usually takes a few minutes; this page updates by itself.
              </p>
              <div className="mt-4 flex items-center gap-2 text-sm text-navy-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> Waiting for the shop
              </div>
            </StatusBlock>
          )}
          {(o.status === "paid" || o.status === "ready") && (
            <StatusBlock icon={<CheckCircle2 className="h-7 w-7 text-emerald-600" />} title={o.status === "ready" ? "Your order is ready for pickup" : "Payment verified. Your order is placed."}>
              <p>
                We received {formatPrice(o.total)} {paidVia}. {o.status === "ready" ? "Your items are packed and waiting at the counter." : "We'll keep your items ready at the counter."}
              </p>
              <ReceiptCard order={o} />
              <Pickup shop={shop} orderNumber={o.orderNumber} />
            </StatusBlock>
          )}
          {o.status === "collected" && (
            <StatusBlock icon={<CheckCircle2 className="h-7 w-7 text-emerald-600" />} title="Collected. Thank you!">
              <p>You collected this order from {shop.name}{o.collectedAt ? ` on ${time(o.collectedAt)}` : ""}.</p>
              <ReceiptCard order={o} />
            </StatusBlock>
          )}
          {o.status === "payment_failed" && gateway && (
            <StatusBlock icon={<XCircle className="h-7 w-7 text-red-600" />} title="The payment didn't go through">
              {o.failureReason && <p className="font-medium text-navy-900">{o.failureReason}</p>}
              <p className="mt-2">No money was taken for this attempt. You can try again; if money did leave your account, {gw} returns it, or contact the shop.</p>
              <RetryPay orderNumber={o.orderNumber} total={o.total} onChanged={refresh} />
            </StatusBlock>
          )}
          {(o.status === "refunding" || o.status === "refunded") && (
            <StatusBlock icon={o.status === "refunded" ? <CheckCircle2 className="h-7 w-7 text-emerald-600" /> : <Clock3 className="h-6 w-6 text-amber-600" />} title={o.status === "refunded" ? "Refunded" : "Refund in progress"}>
              <p>
                {o.status === "refunded"
                  ? `${formatPrice(o.total)} has been refunded to the account you paid from${o.refundedAt ? ` on ${time(o.refundedAt)}` : ""}. Banks can take a few working days to show it.`
                  : `This order was cancelled and ${formatPrice(o.total)} is being refunded through ${gw} to the account you paid from.`}
              </p>
              {o.cancelReason && <p className="mt-2 text-sm text-navy-500">Reason: {o.cancelReason}</p>}
            </StatusBlock>
          )}
          {o.status === "payment_failed" && !gateway && (
            <StatusBlock icon={<XCircle className="h-7 w-7 text-red-600" />} title="We couldn't find this payment">
              {o.failureReason && <p className="font-medium text-navy-900">{o.failureReason}</p>}
              <p className="mt-2">
                If money left your account for this order, contact the shop with your UTR <span className="tabular font-semibold">{o.utr}</span> and we&apos;ll sort it out. Otherwise, add the items to your cart and place a new order.
              </p>
            </StatusBlock>
          )}
          {(o.status === "cancelled" || o.status === "expired") && (
            <StatusBlock icon={<XCircle className="h-7 w-7 text-navy-400" />} title={o.status === "expired" ? "This order expired" : "This order was cancelled"}>
              <p>{o.status === "expired" ? "It wasn't paid in time. Nothing was charged by us; add the items to your cart again to place a new order." : o.cancelReason || "No payment is due."}</p>
            </StatusBlock>
          )}
          {o.status !== "collected" && (wa || shop.phone) && (
            <div className="mt-6 flex flex-wrap gap-2 border-t border-navy-100 pt-5">
              {wa && (
                <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-navy-200 px-4 text-sm font-semibold text-navy-950 transition-colors hover:border-navy-900">
                  <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp the shop
                </a>
              )}
              {shop.phone && (
                <a href={`tel:+91${shop.phone.replace(/\D/g, "").slice(-10)}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-navy-200 px-4 text-sm font-semibold text-navy-950 transition-colors hover:border-navy-900">
                  <Phone className="h-4 w-4" /> {formatPhone(shop.phone)}
                </a>
              )}
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-4 lg:self-start">
        <div className="rounded-xl border border-navy-200 bg-white">
          <div className="flex items-baseline justify-between border-b border-navy-100 px-5 py-3.5">
            <h2 className="font-semibold text-navy-950">Order {o.orderNumber}</h2>
            <span className="text-[12px] text-navy-500">{time(o.createdAt)}</span>
          </div>
          <ul className="divide-y divide-navy-100 px-5">
            {data.lines.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-3 py-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium text-navy-950">{l.productName}</div>
                  <div className="tabular text-[12px] text-navy-500">
                    {l.variantName ? `${l.variantName} · ` : ""}
                    {Number(l.quantity)} {l.unit.toLowerCase()} × {formatPrice(l.unitPrice)}
                  </div>
                </div>
                <span className="shrink-0 tabular text-navy-950">{formatPrice(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1.5 border-t border-navy-100 px-5 py-4 text-sm">
            <div className="flex justify-between"><dt className="text-navy-500">Items</dt><dd className="tabular">{formatPrice(o.subtotal)}</dd></div>
            {Number(o.discount) > 0 && (
              <div className="flex justify-between text-emerald-800"><dt>Discount ({o.couponCode})</dt><dd className="tabular">− {formatPrice(o.discount)}</dd></div>
            )}
            <div className="flex items-baseline justify-between border-t border-navy-100 pt-2.5"><dt className="font-semibold text-navy-950">Total</dt><dd className="tabular text-lg font-semibold text-navy-950">{formatPrice(o.total)}</dd></div>
          </dl>
        </div>
        <p className="text-xs leading-relaxed text-navy-500">
          {["cancelled", "expired", "refunding", "refunded"].includes(o.status) ? "This order is closed." : "Pickup from the store only. The GST bill is made at the counter when you collect."} See our{" "}
          <Link href="/refund-policy" className="underline underline-offset-2 hover:text-navy-800">refund policy</Link> and{" "}
          <Link href="/pickup-policy" className="underline underline-offset-2 hover:text-navy-800">pickup policy</Link>.
        </p>
      </aside>
    </div>
  );
}

function StatusBlock({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="animate-fade-in">
      <div className="flex items-center gap-3">
        {icon}
        <h2 className="headline text-[1.375rem] font-bold text-navy-950 sm:text-[1.5rem]">{title}</h2>
      </div>
      <div className="mt-3 text-[15px] leading-relaxed text-navy-600">{children}</div>
    </div>
  );
}

/** The payment receipt to show at the counter: a receipt, not a tax invoice. */
function ReceiptCard({ order }: { order: OrderData["order"] }) {
  return (
    <div className="mt-5 rounded-lg border border-navy-200 bg-white p-4">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold-600" />
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-navy-950">Your proof of payment</div>
          <p className="mt-1 text-sm leading-relaxed text-navy-600">
            Show this receipt at the counter when you collect. It lists your items and what you paid. It is a payment receipt, not a tax invoice: the shop gives you its bill when you collect.
          </p>
          {order.receiptCode && (
            <p className="mt-2 text-[13px] text-navy-500">
              Receipt code <span className="tabular font-semibold tracking-wide text-navy-950">{order.receiptCode}</span>
            </p>
          )}
          <a
            href={`/api/shop/orders/${order.orderNumber}/receipt?download=1`}
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
          >
            <Download className="h-4 w-4" /> Download payment receipt (PDF)
          </a>
        </div>
      </div>
    </div>
  );
}

function Pickup({ shop, orderNumber }: { shop: Shop; orderNumber: string }) {
  return (
    <div className="mt-5">
      <div className="flex items-start gap-3 rounded-lg border border-navy-200 bg-paper/60 p-4 text-sm text-navy-700">
        <Store className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold-600" />
        <div>
          <div className="font-semibold text-navy-950">Collect from the store only</div>
          <div className="mt-1">{[shop.name, ...shop.address].join(", ")}</div>
          <div className="mt-1">Show order number <span className="tabular font-semibold text-navy-950">{orderNumber}</span> at the counter.</div>
        </div>
      </div>
      <ShopMap name={shop.name} embedUrl={shop.mapEmbedUrl} opensHref={shop.mapUrl} directionsHref={shop.directionsUrl} compact className="mt-3" />
    </div>
  );
}

/** Open Razorpay's payment window for this order and report what came of it. */
function usePay(orderNumber: string, onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pay = async () => {
    setBusy(true);
    setMessage(null);
    const r = await payOrder(orderNumber);
    setBusy(false);
    if (r.kind === "failed") setMessage(r.message);
    else if (r.kind === "dismissed") setMessage(r.lastFailure ? `The payment didn't go through: ${r.lastFailure.replace(/[.\s]*$/, "")}. You can try again.` : "The payment window was closed. You can pay any time from this page.");
    onChanged();
  };
  return { busy, message, pay };
}

function RetryPay({ orderNumber, total, onChanged }: { orderNumber: string; total: string; onChanged: () => void }) {
  const { busy, message, pay } = usePay(orderNumber, onChanged);
  return (
    <div className="mt-5">
      <Button loading={busy} className="h-12 w-full text-[15px] sm:w-auto" onClick={pay}>
        Try again: pay {formatPrice(total)}
      </Button>
      {message && <p className="mt-2 text-[13px] text-red-700">{message}</p>}
    </div>
  );
}

/** Gateway order waiting for payment: open Razorpay's payment window, or wait while it confirms. */
function GatewayPay({ data, onCancelled, onChanged, autoPay }: { data: OrderData; onCancelled: () => void; onChanged: () => void; autoPay: boolean }) {
  const o = data.order;
  const gw = gatewayName(o.paymentMethod);
  const { busy, message, pay } = usePay(o.orderNumber, onChanged);
  const [error, setError] = useState<string | null>(null);
  const confirming = o.gatewayState === "PENDING" && !!o.gatewayPaymentMode;

  // Straight from checkout: open the payment window once, without leaving a ?pay=1 behind to reopen it on refresh.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoPay || !o.canPayNow || opened.current) return;
    opened.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    const t = setTimeout(() => void pay(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once, on arrival
  }, []);

  const cancel = async () => {
    if (!confirm("Cancel this order? Only do this if you haven't paid.")) return;
    try {
      await apiFetch(`/api/shop/orders/${o.orderNumber}/cancel`, { body: {} });
    } catch (err) {
      setError(errorMessage(err));
      return;
    }
    onCancelled();
  };
  return (
    <div>
      <h2 className="headline text-[1.375rem] font-bold text-navy-950 sm:text-[1.5rem]">{confirming ? "Confirming your payment" : `Pay ${formatPrice(o.total)}`}</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-navy-600">
        {confirming
          ? `${gw} is confirming your payment. This page updates by itself in a few seconds; please don't pay again.`
          : `You pay in ${gw}'s secure window with any UPI app, a debit or credit card, net banking or a wallet. If you've just paid, this page updates by itself in a few seconds.`}
      </p>
      {!confirming && o.canPayNow && (
        <Button loading={busy} className="mt-5 h-12 w-full text-[15px] sm:w-auto" onClick={pay}>
          Pay {formatPrice(o.total)} securely
        </Button>
      )}
      <div className="mt-4 flex items-center gap-2 text-sm text-navy-500">
        <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> Waiting for {gw}
      </div>
      {(message || error) && <p className="mt-3 text-[13px] text-red-700">{message ?? error}</p>}
      <Alert tone="info" className="mt-5">
        Your order is placed as soon as {gw} confirms the payment. Items are collected from the store only.
      </Alert>
      {!confirming && (
        <button type="button" onClick={cancel} className="mt-4 text-[13px] font-medium text-navy-500 underline-offset-4 hover:text-navy-900 hover:underline">
          Cancel this order
        </button>
      )}
    </div>
  );
}

function PayNow({ data, onSubmitted, onCancelled }: { data: OrderData; onSubmitted: (d: OrderData) => void; onCancelled: () => void }) {
  const o = data.order;
  const { left, label } = useCountdown(o.expiresAt, true);
  const [utr, setUtr] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = utr.replace(/\s+/g, "");
    if (!/^\d{12}$/.test(clean)) {
      setError("The UTR is 12 digits. Copy it from the payment details in your UPI app.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/shop/orders/${o.orderNumber}/utr`, { body: { utr: clean } });
      onSubmitted(await apiFetch<OrderData>(`/api/shop/orders/${o.orderNumber}`));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!confirm("Cancel this order? You haven't paid yet.")) return;
    await apiFetch(`/api/shop/orders/${o.orderNumber}/cancel`, { body: {} }).catch(() => {});
    onCancelled();
  };

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="headline text-[1.375rem] font-bold text-navy-950 sm:text-[1.5rem]">Pay {formatPrice(o.total)}</h2>
        <span className={cn("tabular text-sm", left < 5 * 60_000 ? "font-semibold text-red-700" : "text-navy-500")}>{left > 0 ? `Pay within ${label}` : "Time to pay has run out"}</span>
      </div>
      <p className="mt-1 text-sm text-navy-500">
        Scan with any UPI app. It pays <span className="tabular text-navy-800">{o.upiVpa ?? ""}</span> exactly {formatPrice(o.total)}; please don&apos;t change the amount.
      </p>
      <div className="mt-5 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- SVG generated for this order */}
        <img src={`/api/shop/orders/${o.orderNumber}/qr`} alt={`UPI QR code to pay ${formatPrice(o.total)} for order ${o.orderNumber}`} width={216} height={216} className="h-54 w-54 rounded-lg border border-navy-200 bg-white p-1" />
        <div className="w-full space-y-3 text-sm">
          {o.qrPayload && (
            <a href={o.qrPayload} className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-navy-200 font-semibold text-navy-950 transition-colors hover:border-navy-900 sm:hidden">
              <Smartphone className="h-4 w-4" /> Open a UPI app on this phone
            </a>
          )}
          {o.qrPayload && (
            <p className="text-[12px] leading-snug text-navy-500 sm:hidden">
              If your app won&apos;t open it, use &ldquo;Pay to UPI ID&rdquo; in your app: <span className="tabular text-navy-800">{o.upiVpa}</span>, exactly {formatPrice(o.total)}.
            </p>
          )}
          <form onSubmit={submit} className="rounded-lg border border-navy-200 bg-paper/50 p-4">
            <label htmlFor="utr" className="block font-semibold text-navy-950">After paying, enter the UPI transaction ID</label>
            <p className="mt-1 text-[13px] leading-snug text-navy-500">12 digits, shown as UTR, UPI Ref. No. or Transaction ID in your UPI app&apos;s payment details.</p>
            <div className="mt-3 flex gap-2">
              <Input id="utr" inputMode="numeric" autoComplete="off" maxLength={16} placeholder="e.g. 412345678901" value={utr} onChange={(e) => setUtr(e.target.value)} className="h-11 tabular tracking-wide" />
              <Button type="submit" loading={busy} className="h-11 shrink-0">Submit</Button>
            </div>
            {error && <p className="mt-2 text-[13px] text-red-700">{error}</p>}
          </form>
        </div>
      </div>
      <Alert tone="info" className="mt-5">
        Your order is placed once the shop confirms this payment against its bank account. Items are collected from the store only.
      </Alert>
      <button type="button" onClick={cancel} className="mt-4 text-[13px] font-medium text-navy-500 underline-offset-4 hover:text-navy-900 hover:underline">
        Cancel this order
      </button>
    </div>
  );
}
