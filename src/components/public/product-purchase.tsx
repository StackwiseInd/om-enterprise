"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, MessageCircle, Minus, Plus, ShoppingCart } from "lucide-react";
import type { PublicVariant } from "@/server/services/public-catalog";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { D, formatPrice, formatQty } from "@/lib/money";
import { lineDescription } from "@/lib/line-description";
import { whatsappLink } from "@/lib/india";
import { PriceTag } from "./price";
import { useEnquiryList } from "./cart-store";
import { useProductSelection } from "./product-selection";

function clampQty(raw: string, decimals: number): string | null {
  const s = raw.trim();
  if (!s) return null;
  const re = decimals > 0 ? new RegExp(`^\\d{1,6}(\\.\\d{1,${decimals}})?$`) : /^\d{1,6}$/;
  if (!re.test(s)) return null;
  if (Number(s) <= 0) return null;
  return s;
}

export function ProductPurchase({
  productName,
  slug,
  variantAttributes,
  variants,
  whatsapp,
  enquiriesEnabled,
}: {
  productName: string;
  slug: string;
  variantAttributes: string[];
  variants: PublicVariant[];
  whatsapp: string | null;
  enquiriesEnabled: boolean;
}) {
  const toast = useToast();
  const list = useEnquiryList();
  const { selectedId, setSelectedId } = useProductSelection(variants[0]?.id ?? "");
  const [qtyText, setQtyText] = useState("1");
  const selected = variants.find((v) => v.id === selectedId) ?? variants[0];

  // Phones: while the main buttons are off screen, a bar at the bottom keeps the price and the
  // actions in reach. Starts hidden (as rendered on the server) until the observer reports.
  const actionsRef = useRef<HTMLDivElement>(null);
  const [actionsInView, setActionsInView] = useState(true);
  useEffect(() => {
    const el = actionsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setActionsInView(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const attrs = useMemo(
    () => variantAttributes.filter((a) => variants.length > 1 && variants.every((v) => v.attributes[a])),
    [variantAttributes, variants],
  );

  if (!selected) {
    return <p className="text-sm text-navy-500">This product is currently not available. Please contact us.</p>;
  }

  const decimals = selected.unitDecimals;
  const qty = clampQty(qtyText, decimals);
  // The price the quantity qualifies for (the highest quantity break reached), and the line total.
  let unitAmount = selected.price && qty ? selected.price.amount : null;
  for (const t of selected.price && qty ? selected.price.tiers : []) if (D(qty).greaterThanOrEqualTo(D(t.minQty))) unitAmount = t.amount;
  const step = (dir: 1 | -1) => {
    const n = Math.max(decimals ? 10 ** -decimals : 1, (Number(qty ?? "1") || 1) + dir);
    setQtyText(String(Math.round(n * 10 ** decimals) / 10 ** decimals));
  };

  const pickAttr = (attr: string, value: string) => {
    const current = selected.attributes;
    const exact = variants.find((v) => attrs.every((a) => (a === attr ? v.attributes[a] === value : v.attributes[a] === current[a])));
    const loose = variants.find((v) => v.attributes[attr] === value);
    const next = exact ?? loose;
    if (next) setSelectedId(next.id);
  };

  const inList = list.items.some((i) => i.variantId === selected.id);
  const waText = `Hello OM ENTERPRISE, I'm interested in:\n${lineDescription(null, productName, selected.name)} (SKU ${selected.sku})\nQuantity: ${qty ?? qtyText} ${selected.unit}\nPlease share availability and price.`;

  const add = () => {
    if (!qty) {
      toast(decimals ? `Enter a quantity with up to ${decimals} decimal places` : "Enter a whole-number quantity", "error");
      return;
    }
    list.add({
      variantId: selected.id,
      quantity: qty,
      productName,
      variantName: selected.name,
      slug,
      unit: selected.unit,
      unitDecimals: decimals,
    });
    toast(
      <span>
        Added to your cart.{" "}
        <Link href="/enquiry" className="font-bold underline">
          View cart
        </Link>
      </span>,
    );
  };

  return (
    <div className="space-y-6">
      {attrs.length > 0 ? (
        attrs.map((attr) => {
          const values = [...new Set(variants.map((v) => v.attributes[attr]))];
          if (values.length === 1) {
            return (
              <div key={attr} className="flex items-baseline gap-2">
                <span className="label-sm text-navy-500">{attr}</span>
                <span className="tabular text-sm text-navy-950">{values[0]}</span>
              </div>
            );
          }
          return (
            <fieldset key={attr}>
              <legend className="flex items-baseline gap-2">
                <span className="label-sm text-navy-500">{attr}</span>
                <span key={selected.attributes[attr]} className="animate-fade-in tabular text-sm text-navy-950">
                  {selected.attributes[attr]}
                </span>
              </legend>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {values.map((val) => {
                  const active = selected.attributes[attr] === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => pickAttr(attr, val)}
                      aria-pressed={active}
                      className={cn(
                        "min-h-10 rounded-md border px-3.5 tabular text-[13px] transition-[background-color,border-color,color] duration-150 active:translate-y-px",
                        active ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-800 hover:border-navy-900",
                      )}
                    >
                      {val}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })
      ) : variants.length > 1 ? (
        <fieldset>
          <legend className="label-sm text-navy-500">Choose an option</legend>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            {variants.map((v) => {
              const active = v.id === selected.id;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setSelectedId(v.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3.5 py-2.5 text-left text-sm transition-[background-color,border-color,color] duration-150 active:translate-y-px",
                    active ? "border-navy-900 bg-navy-900 text-white" : "border-navy-200 bg-white text-navy-800 hover:border-navy-900",
                  )}
                >
                  <span className="font-medium">{v.name}</span>
                  {v.price && <span className={cn("tabular text-[13px]", active ? "text-gold-300" : "text-navy-500")}>{formatPrice(v.price.amount)}</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      <div className="rounded-xl border border-navy-200 bg-white">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-navy-100 px-5 py-3 tabular text-[12px]">
          <span className="text-navy-900">{selected.name}</span>
          <span className="text-navy-500">
            SKU {selected.sku} · per {selected.unit.toLowerCase()}
          </span>
        </div>
        <div className="px-5 pt-5">
        <div key={selected.id} className="animate-fade-in">
          <PriceTag price={selected.price} size="lg" />
        </div>
        {selected.price && selected.price.tiers.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-navy-700">
            {selected.price.tiers.map((t) => (
              <li key={t.minQty} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-emerald-600" />
                <span>
                  <span className="tabular font-medium">{formatPrice(t.amount)}</span> each for {Number(t.minQty)}+ {selected.unit.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div ref={actionsRef} className="mt-6 flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="qty" className="label-sm block text-navy-500">
              Quantity · {selected.unit.toLowerCase()}
            </label>
            <div className="mt-1.5 flex h-12 items-center overflow-hidden rounded-lg border border-navy-200 bg-white transition-[border-color,box-shadow] focus-within:border-navy-800 focus-within:ring-[3px] focus-within:ring-gold-300/45">
              <button type="button" onClick={() => step(-1)} className="flex h-full w-11 items-center justify-center text-navy-700 transition-colors hover:bg-navy-50" aria-label="Decrease quantity">
                <Minus className="h-4 w-4" />
              </button>
              <input
                id="qty"
                inputMode={decimals ? "decimal" : "numeric"}
                value={qtyText}
                onChange={(e) => setQtyText(e.target.value)}
                aria-invalid={!qty}
                className="h-full w-20 border-x border-navy-100 text-center tabular text-base font-medium text-navy-950 focus:outline-none"
              />
              <button type="button" onClick={() => step(1)} className="flex h-full w-11 items-center justify-center text-navy-700 transition-colors hover:bg-navy-50" aria-label="Increase quantity">
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          {enquiriesEnabled && (
            <button
              type="button"
              onClick={add}
              className="inline-flex h-12 min-w-[13rem] flex-1 items-center justify-center gap-2 rounded-lg bg-navy-900 px-5 text-[15px] font-semibold text-white shadow-[inset_0_-1px_0_rgb(0_0_0/0.35)] transition-[background-color,transform] hover:bg-navy-800 active:translate-y-px"
            >
              <ShoppingCart className="h-[18px] w-[18px]" /> {inList ? "Add more to cart" : "Add to cart"}
            </button>
          )}
        </div>
        {!qty && <p className="mt-2 text-xs text-red-700">{decimals ? `Up to ${decimals} decimal places allowed.` : "Whole numbers only."}</p>}
        {qty && unitAmount && Number(qty) !== 1 && (
          <p className="mt-4 flex items-baseline justify-between gap-3 border-t border-navy-100 pt-3 tabular text-[13px] text-navy-500">
            <span>
              {formatQty(qty)} {selected.unit.toLowerCase()} × {formatPrice(unitAmount)}
            </span>
            <span key={`${qty}-${unitAmount}`} className="animate-fade-in text-[15px] font-semibold text-navy-950">
              {formatPrice(D(qty).times(D(unitAmount)).toFixed(2))}
            </span>
          </p>
        )}
        </div>
        {whatsapp && (
          <div className="mt-5 border-t border-navy-100 p-3">
            <a
              href={whatsappLink(whatsapp, waText)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-navy-200 bg-white px-5 text-[15px] font-semibold text-navy-950 transition-colors hover:border-navy-900"
            >
              <MessageCircle className="h-[18px] w-[18px] text-emerald-600" /> Ask on WhatsApp
            </a>
          </div>
        )}
        {!whatsapp && <div className="pb-5" />}
      </div>

      {(enquiriesEnabled || whatsapp) && (
        <div
          data-bottom-bar
          data-product-bar
          inert={actionsInView}
          aria-hidden={actionsInView}
          className={cn(
            "fixed inset-x-0 bottom-0 z-30 border-t border-navy-200 bg-white px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 transition-transform duration-300 ease-out-quart lg:hidden",
            actionsInView ? "translate-y-full" : "translate-y-0",
          )}
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-navy-500">{selected.name}</div>
              <div key={selected.id} className="animate-fade-in tabular text-lg font-semibold leading-tight tracking-[-0.02em] text-navy-950">
                {selected.price ? formatPrice(unitAmount ?? selected.price.amount) : <span className="text-sm font-medium text-navy-500">Price on request</span>}
              </div>
            </div>
            {whatsapp && (
              <a
                href={whatsappLink(whatsapp, waText)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Ask about this item on WhatsApp"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-navy-200 text-emerald-600 transition-colors hover:border-navy-900"
              >
                <MessageCircle className="h-5 w-5" />
              </a>
            )}
            {enquiriesEnabled && (
              <button
                type="button"
                onClick={add}
                className="inline-flex h-11 shrink-0 items-center gap-2 rounded-lg bg-navy-900 px-4 text-[15px] font-semibold text-white transition-colors hover:bg-navy-800 active:translate-y-px"
              >
                <ShoppingCart className="h-[18px] w-[18px]" /> {inList ? "Add more" : "Add"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
