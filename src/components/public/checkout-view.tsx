"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Store, Tag, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { ShopMap } from "./shop-map";
import { gatewayName, isGatewayMethod, type PaymentMethod } from "@/lib/gateway";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatPhone } from "@/lib/india";
import { formatPrice } from "@/lib/money";
import { useEnquiryList } from "./cart-store";

interface Preview {
  lines: { variantId: string; productName: string; variantName: string; unit: string; quantity: string; unitPrice: string | null; lineTotal: string | null }[];
  coupon: { code: string; amountOff: string } | null;
  subtotal: string;
  discount: string;
  total: string;
}

export function CheckoutView({ account, pickup, shopName, mode, map }: { account: { name: string; mobile: string }; pickup: string; shopName: string; mode: PaymentMethod | null; map: { embedUrl: string; opensHref: string; directionsHref: string } }) {
  const onlinePay = mode !== null;
  const router = useRouter();
  const cart = useEnquiryList();
  const items = useMemo(() => cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), [cart.items]);
  const key = JSON.stringify(items);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"code" | "place" | null>(null);

  // Price the cart (and the applied code) on the server whenever either changes.
  useEffect(() => {
    if (!items.length) return;
    const ctrl = new AbortController();
    apiFetch<Preview>("/api/shop/checkout", { body: { items, couponCode: applied }, signal: ctrl.signal })
      .then((p) => {
        setPreview(p);
        setError(null);
        setBusy((b) => (b === "code" ? null : b));
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setBusy((b) => (b === "code" ? null : b));
        if (applied) {
          // A code that doesn't fit is dropped and its reason shown; the cart is re-priced without it.
          setCodeError(errorMessage(err));
          setApplied(null);
        } else {
          setError(errorMessage(err));
          setPreview(null);
        }
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-price when the cart or the code changes
  }, [key, applied]);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy("code");
    setCodeError(null);
    setApplied(code.trim());
  };
  const removeCode = () => {
    setApplied(null);
    setCode("");
    setCodeError(null);
  };

  const place = async () => {
    setBusy("place");
    setError(null);
    try {
      const { orderNumber } = await apiFetch<{ orderNumber: string }>("/api/shop/orders", { body: { items, couponCode: applied } });
      cart.clear();
      // Razorpay: the order page opens its payment window on arrival; the UPI QR order page just shows the QR.
      router.push(`/my-orders/${orderNumber}${isGatewayMethod(mode) ? "?pay=1" : ""}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(null);
    }
  };

  if (!onlinePay) return <Alert tone="info">Online payment isn&apos;t available right now. You can still <Link href="/enquiry" className="font-semibold underline">send your cart as a request</Link>.</Alert>;
  if (!cart.items.length)
    return (
      <div className="space-y-4">
        <WaitingOrders />
        <div className="blueprint rounded-xl border border-navy-200 p-10 text-center">
          <p className="font-semibold text-navy-950">Your cart is empty</p>
          <Link href="/products" className="mt-4 inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">Browse products</Link>
        </div>
      </div>
    );

  return (
    <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr]">
      <section aria-labelledby="co-items">
        <h2 id="co-items" className="border-b border-navy-200 pb-2.5 text-lg font-semibold text-navy-950">Your items</h2>
        {error && <Alert tone="danger" className="mt-4">{error} <Link href="/enquiry" className="font-semibold underline">Back to cart</Link></Alert>}
        <ul className="divide-y divide-navy-100">
          {(preview?.lines ?? []).map((l) => (
            <li key={l.variantId} className="flex items-baseline justify-between gap-4 py-3.5">
              <div className="min-w-0">
                <div className="font-semibold text-navy-950">{l.productName}</div>
                <div className="tabular text-[13px] text-navy-500">
                  {l.variantName} · {Number(l.quantity)} {l.unit.toLowerCase()} × {formatPrice(l.unitPrice)}
                </div>
              </div>
              <div className="shrink-0 tabular font-semibold text-navy-950">{formatPrice(l.lineTotal)}</div>
            </li>
          ))}
          {!preview && !error && Array.from({ length: Math.min(3, cart.items.length) }).map((_, i) => <li key={i} className="h-14 animate-pulse py-3.5"><div className="h-full rounded bg-navy-100" /></li>)}
        </ul>
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-navy-200 bg-paper/60 p-4 text-sm text-navy-700">
          <Store className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold-600" />
          <div>
            <div className="font-semibold text-navy-950">Pickup from the store only</div>
            <div className="mt-0.5">{shopName}, {pickup}. We keep your items ready once your payment is confirmed.</div>
            <details className="group mt-2">
              <summary className="cursor-pointer text-[13px] font-semibold text-navy-950 underline-offset-4 hover:underline">Show the shop on the map</summary>
              <ShopMap name={shopName} embedUrl={map.embedUrl} opensHref={map.opensHref} directionsHref={map.directionsHref} compact className="mt-3" />
            </details>
          </div>
        </div>
      </section>

      <section aria-labelledby="co-pay" className="rounded-xl border border-navy-200 bg-white lg:self-start">
        <div className="border-b border-navy-100 px-5 py-4 sm:px-6">
          <h2 id="co-pay" className="text-lg font-semibold text-navy-950">Payment</h2>
          <p className="mt-0.5 text-[13px] text-navy-500">
            Ordering as {account.name} · <span className="tabular">{formatPhone(account.mobile)}</span>
          </p>
        </div>
        <div className="space-y-4 px-5 py-5 sm:px-6">
          {applied && preview?.coupon && busy !== "code" ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-900">
              <span className="flex items-center gap-2"><Tag className="h-4 w-4" /> Code <span className="tabular font-semibold">{preview.coupon.code}</span> applied</span>
              <button type="button" onClick={removeCode} className="rounded p-1 text-emerald-800 hover:bg-emerald-100" aria-label="Remove code"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <form onSubmit={apply}>
              <label htmlFor="co-code" className="mb-1.5 block text-[13px] font-medium text-navy-700">Discount code</label>
              <div className="flex gap-2">
                <Input id="co-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="OM-XXXX-XXXX" autoCapitalize="characters" autoComplete="off" className="h-11 uppercase tabular" />
                <Button type="submit" variant="outline" loading={busy === "code"} className="h-11 shrink-0">Apply</Button>
              </div>
              {codeError && <p className="mt-1.5 text-xs text-red-700">{codeError}</p>}
            </form>
          )}
          <dl className="space-y-2 border-t border-navy-100 pt-4 text-sm">
            <div className="flex justify-between"><dt className="text-navy-500">Items</dt><dd className="tabular text-navy-950">{preview ? formatPrice(preview.subtotal) : "…"}</dd></div>
            {preview && Number(preview.discount) > 0 && (
              <div className="flex justify-between text-emerald-800"><dt>Discount ({preview.coupon?.code})</dt><dd className="tabular">− {formatPrice(preview.discount)}</dd></div>
            )}
            <div className="flex items-baseline justify-between border-t border-navy-100 pt-3"><dt className="font-semibold text-navy-950">To pay</dt><dd className="tabular text-2xl font-semibold tracking-[-0.02em] text-navy-950">{preview ? formatPrice(preview.total) : "…"}</dd></div>
          </dl>
          <Button onClick={place} loading={busy === "place"} disabled={!preview || !!error} className="h-12 w-full text-[15px]">
            Place order and pay {preview ? formatPrice(preview.total) : ""}
          </Button>
          <p className="text-xs leading-relaxed text-navy-500">
            {isGatewayMethod(mode)
              ? `You'll pay in ${gatewayName(mode)}'s secure window by UPI, card, net banking or wallet. As soon as ${gatewayName(mode)} confirms the payment, your order is placed.`
              : "Next you'll see a UPI QR for this exact amount. After paying, enter the UPI transaction ID (UTR). We confirm the payment against our bank account, then your order is placed."}
          </p>
          <p className="text-xs leading-relaxed text-navy-500">
            Orders are collected from the shop. By placing the order you agree to our{" "}
            <Link href="/terms" className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-950">terms</Link>,{" "}
            <Link href="/refund-policy" className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-950">refund policy</Link> and{" "}
            <Link href="/pickup-policy" className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-950">pickup policy</Link>.
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * The cart is emptied when an order is placed, so a customer who comes back from the payment page with
 * the Back button lands here. Show any order still waiting for payment, with a way to finish it.
 */
function WaitingOrders() {
  const [orders, setOrders] = useState<{ orderNumber: string; total: string }[]>([]);
  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch<{ orderNumber: string; status: string; total: string }[]>("/api/shop/orders", { signal: ctrl.signal })
      .then((list) => setOrders(list.filter((o) => o.status === "awaiting_payment")))
      .catch(() => {});
    return () => ctrl.abort();
  }, []);
  if (!orders.length) return null;
  return (
    <div role="status" className="rounded-xl border border-gold-300 bg-gold-50/60 p-5">
      <p className="font-semibold text-navy-950">{orders.length === 1 ? "You have an order waiting for payment" : `You have ${orders.length} orders waiting for payment`}</p>
      <ul className="mt-3 space-y-2">
        {orders.map((o) => (
          <li key={o.orderNumber} className="flex flex-wrap items-center justify-between gap-3">
            <span className="tabular text-sm text-navy-700">
              {o.orderNumber} · <span className="font-semibold text-navy-950">{formatPrice(o.total)}</span>
            </span>
            <Link href={`/my-orders/${o.orderNumber}`} className="inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">
              Continue to payment
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
