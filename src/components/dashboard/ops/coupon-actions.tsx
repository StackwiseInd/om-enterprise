"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";

/** Generate a batch of single-use flat-discount codes. */
export function CouponGenerator() {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ label: "", amountOff: "100", minOrder: "", count: "20", validUntil: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { batchId } = await apiFetch<{ batchId: string }>("/api/admin/coupons", {
        body: { label: f.label.trim(), amountOff: f.amountOff.trim(), minOrder: f.minOrder.trim(), count: Number(f.count), validUntil: f.validUntil || null },
      });
      toast(`${f.count} codes generated`);
      router.push(`/dashboard/coupons/${batchId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Name" htmlFor="c-label" required hint="For your records, e.g. “Diwali ₹100 off” or “Contractor cards”.">
        <Input id="c-label" value={f.label} onChange={set("label")} maxLength={80} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount off (₹)" htmlFor="c-amount" required hint="Flat, off the order total.">
          <Input id="c-amount" inputMode="decimal" value={f.amountOff} onChange={set("amountOff")} className="tabular" />
        </Field>
        <Field label="Minimum order (₹)" htmlFor="c-min" hint="Optional. Must be more than the amount off.">
          <Input id="c-min" inputMode="decimal" value={f.minOrder} onChange={set("minOrder")} className="tabular" placeholder="No minimum" />
        </Field>
        <Field label="How many codes" htmlFor="c-count" required hint="Each code works once. Up to 500.">
          <Input id="c-count" inputMode="numeric" value={f.count} onChange={set("count")} className="tabular" />
        </Field>
        <Field label="Valid until" htmlFor="c-until" hint="Optional. Through the end of that day.">
          <Input id="c-until" type="date" value={f.validUntil} onChange={set("validUntil")} />
        </Field>
      </div>
      <Button type="submit" loading={busy} icon={<Ticket className="h-4 w-4" />}>
        Generate codes
      </Button>
    </form>
  );
}

/** Disable one unused code, or every unused code in a batch. */
export function DisableCouponsButton({ couponId, batchId, label }: { couponId?: string; batchId?: string; label: string }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      icon={<Ban className="h-3.5 w-3.5" />}
      onClick={async () => {
        if (!confirm(batchId ? "Disable every unused code in this batch? Codes already on orders are kept." : "Disable this code?")) return;
        setBusy(true);
        try {
          const r = await apiFetch<{ disabled: number }>(couponId ? `/api/admin/coupons/${couponId}/disable` : `/api/admin/coupons/batches/${batchId}/disable`, { body: {} });
          toast(`${r.disabled} code${r.disabled === 1 ? "" : "s"} disabled`);
          router.refresh();
        } catch (err) {
          toast(errorMessage(err), "error");
        } finally {
          setBusy(false);
        }
      }}
    >
      {label}
    </Button>
  );
}
