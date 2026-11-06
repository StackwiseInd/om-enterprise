"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Minus, Plus, QrCode, ShoppingCart, Trash2 } from "lucide-react";
import { SampleBadge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api-client";
import { formatPrice } from "@/lib/money";
import { useEnquiryList } from "./cart-store";
import { EnquiryForm, EnquirySuccess, type EnquiryDone } from "./enquiry-form";

interface PricedLine {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  unit: string;
  quantity: string;
  unitPrice: string | null;
  lineTotal: string | null;
  isSample: boolean;
}
interface Priced {
  lines: PricedLine[];
  total: string;
  allPriced: boolean;
}

function validQty(s: string, decimals: number) {
  const re = decimals > 0 ? new RegExp(`^\\d{1,6}(\\.\\d{1,${decimals}})?$`) : /^\d{1,6}$/;
  return re.test(s) && Number(s) > 0;
}

export function EnquiryList({ whatsapp, priceNote, enquiriesEnabled, onlinePay }: { whatsapp: string | null; priceNote: string; enquiriesEnabled: boolean; onlinePay: boolean }) {
  const list = useEnquiryList();
  const [pricedState, setPriced] = useState<Priced | null>(null);
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState<EnquiryDone | null>(null);

  const validItems = useMemo(
    () => list.items.filter((i) => validQty(i.quantity, i.unitDecimals ?? 0)).map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
    [list.items],
  );
  const key = JSON.stringify(validItems);
  const priced = validItems.length ? pricedState : null;

  useEffect(() => {
    if (!validItems.length) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      apiFetch<Priced>("/api/public/cart", { method: "POST", body: { items: validItems }, signal: ctrl.signal })
        .then(setPriced)
        .catch(() => {
          if (!ctrl.signal.aborted) setPriced(null);
        })
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-price only when the item list actually changes
  }, [key]);

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl">
        <EnquirySuccess done={submitted} whatsapp={whatsapp} />
      </div>
    );
  }

  const lineFor = (variantId: string) => priced?.lines.find((l) => l.variantId === variantId);
  const unavailable = priced ? list.items.filter((i) => !lineFor(i.variantId)) : [];
  const commit = (variantId: string, decimals: number) => {
    const v = drafts[variantId];
    if (v !== undefined && validQty(v, decimals)) list.setQuantity(variantId, v);
    setDrafts((d) => {
      const next = { ...d };
      delete next[variantId];
      return next;
    });
  };
  const bump = (variantId: string, current: string, decimals: number, dir: 1 | -1) => {
    const n = Math.round((Number(current) + dir) * 10 ** decimals) / 10 ** decimals;
    if (n > 0) list.setQuantity(variantId, String(n));
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr]">
      <section aria-labelledby="list-heading">
        <h2 id="list-heading" className="flex items-center gap-2 border-b border-navy-200 pb-2.5 text-lg font-semibold tracking-[-0.01em] text-navy-950">
          <ShoppingCart className="h-[18px] w-[18px] text-gold-600" /> Your cart
          {list.count > 0 && <span className="ml-auto text-[13px] font-normal text-navy-500 tabular">{list.count} {list.count === 1 ? "item" : "items"}</span>}
        </h2>
        {list.items.length === 0 ? (
          <div className="blueprint mt-5 rounded-xl border border-navy-200 p-10 text-center">
            <p className="font-semibold text-navy-950">Your cart is empty</p>
            <p className="mt-1 text-sm text-navy-500">Add products from the catalogue, or just tell us what you need using the form.</p>
            <Link href="/products" className="mt-5 inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-800">
              Browse products
            </Link>
          </div>
        ) : (
          <>
            <ul className="stagger divide-y divide-navy-100">
              {list.items.map((item) => {
                const line = lineFor(item.variantId);
                const decimals = item.unitDecimals ?? 0;
                const draft = drafts[item.variantId];
                return (
                  <li key={item.variantId} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <Link href={`/products/${item.slug}`} className="link-draw font-semibold text-navy-950">
                        {line?.productName ?? item.productName}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 tabular text-[12px] text-navy-500">
                        <span>{line?.variantName ?? item.variantName}</span>
                        {line?.isSample && <SampleBadge />}
                      </div>
                      <div className="mt-1 tabular text-[13px] text-navy-700">
                        {line?.unitPrice ? (
                          <>
                            {formatPrice(line.unitPrice)} <span className="text-navy-400">/ {item.unit.toLowerCase()}</span>
                          </>
                        ) : priced && !line ? (
                          <span className="text-red-700">No longer available online</span>
                        ) : priced ? (
                          <span className="text-navy-500">Price on request</span>
                        ) : (
                          <span className="inline-block h-4 w-20 animate-pulse rounded bg-navy-100" />
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 sm:justify-end">
                      <div className="flex h-10 items-center overflow-hidden rounded-lg border border-navy-200 bg-white">
                        <button type="button" onClick={() => bump(item.variantId, item.quantity, decimals, -1)} className="flex h-full w-9 items-center justify-center transition-colors hover:bg-navy-50" aria-label={`Decrease quantity of ${item.productName}`}>
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          value={draft ?? item.quantity}
                          inputMode={decimals ? "decimal" : "numeric"}
                          aria-label={`Quantity of ${item.productName} (${item.unit})`}
                          onChange={(e) => setDrafts((d) => ({ ...d, [item.variantId]: e.target.value }))}
                          onBlur={() => commit(item.variantId, decimals)}
                          onKeyDown={(e) => e.key === "Enter" && commit(item.variantId, decimals)}
                          className="h-full w-16 border-x border-navy-100 text-center tabular text-sm font-medium focus:outline-none"
                        />
                        <button type="button" onClick={() => bump(item.variantId, item.quantity, decimals, 1)} className="flex h-full w-9 items-center justify-center transition-colors hover:bg-navy-50" aria-label={`Increase quantity of ${item.productName}`}>
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="w-28 text-right tabular text-sm font-semibold text-navy-950">{line?.lineTotal ? formatPrice(line.lineTotal) : "—"}</div>
                      <button type="button" onClick={() => list.remove(item.variantId)} className="rounded-md p-2 text-navy-400 transition-colors hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${item.productName}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            {unavailable.length > 0 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {unavailable.length === 1 ? "One item is" : `${unavailable.length} items are`} no longer listed online. Remove {unavailable.length === 1 ? "it" : "them"} before sending, or ask us about it in the message.
                </span>
              </div>
            )}
            <div className="mt-2 rounded-xl bg-navy-950 p-5 text-white">
              <div className="flex items-baseline justify-between gap-4">
                <span className="label-sm text-navy-300">Total</span>
                <span className="tabular text-2xl font-semibold tracking-[-0.02em]">{loading && !priced ? "…" : priced ? formatPrice(priced.total) : "—"}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-navy-300">
                {priced && !priced.allPriced ? "Some items are priced on request and are not included. " : ""}
                {priceNote || "Prices are confirmed when we prepare your bill."} Final amount, availability and any delivery charges are confirmed by the shop.
              </p>
            </div>
            {onlinePay && (
              <div className="mt-4 rounded-xl border border-navy-200 bg-white p-5">
                <div className="flex items-start gap-3">
                  <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-gold-600" />
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-navy-950">Pay online, collect from the store</h3>
                    <p className="mt-1 text-sm leading-relaxed text-navy-500">Sign in, add a discount code if you have one, and pay online. Once the payment is confirmed, we keep the items ready at the counter.</p>
                  </div>
                </div>
                {priced && (!priced.allPriced || unavailable.length > 0 || priced.lines.some((l) => l.isSample)) ? (
                  <p className="mt-4 rounded-lg bg-navy-50 px-4 py-3 text-sm text-navy-700">
                    {unavailable.length ? "Remove items that are no longer listed to pay online." : priced.lines.some((l) => l.isSample) ? "Sample (demonstration) items can't be bought online." : "Items priced on request can't be paid online yet. Remove them, or send the cart as a request."}
                  </p>
                ) : (
                  <Link
                    href="/checkout"
                    className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-navy-900 px-5 text-[15px] font-semibold text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.35)] transition-colors hover:bg-navy-800"
                  >
                    Checkout and pay online <ArrowRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            )}
          </>
        )}
      </section>
      <section aria-labelledby="form-heading" className="rounded-xl border border-navy-200 bg-white p-5 sm:p-7 lg:self-start">
        <h2 id="form-heading" className="text-lg font-semibold tracking-[-0.01em] text-navy-950">
          {list.items.length ? (onlinePay ? "Or send it as a request" : "Send your list to the shop") : "Tell us what you need"}
        </h2>
        <p className="mt-1 text-sm text-navy-500">We&apos;ll call or WhatsApp you to confirm. Nothing is charged online.</p>
        <div className="mt-5">
          {enquiriesEnabled ? (
            <EnquiryForm
              items={unavailable.length ? validItems.filter((i) => lineFor(i.variantId)) : validItems}
              whatsapp={whatsapp}
              allowOrderRequest
              onSubmitted={(done) => {
                list.clear();
                setSubmitted(done);
              }}
            />
          ) : (
            <div className="rounded-lg bg-navy-50 p-4 text-sm text-navy-700">
              Online enquiries are paused right now. Please call or WhatsApp us — we&apos;re happy to help.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
