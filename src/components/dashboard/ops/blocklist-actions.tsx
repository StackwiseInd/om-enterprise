"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { ApiError, apiFetch, errorMessage } from "@/lib/api-client";

/** Block a mobile number or email address from the website. */
export function AddBlock() {
  const router = useRouter();
  const toast = useToast();
  const [kind, setKind] = useState<"mobile" | "email">("mobile");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ value?: string; reason?: string; form?: string }>({});
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const r = await apiFetch<{ value: string; bannedAccounts: number }>("/api/admin/blocklist", { body: { kind, value: value.trim(), reason: reason.trim() } });
      toast(`${r.value} blocked${r.bannedAccounts ? ` · ${r.bannedAccounts} account${r.bannedAccounts === 1 ? "" : "s"} using it banned` : ""}`);
      setValue("");
      setReason("");
      router.refresh();
    } catch (err) {
      const field = err instanceof ApiError ? (err.details?.field as "value" | "reason" | undefined) : undefined;
      setErrors(field ? { [field]: errorMessage(err) } : { form: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-navy-100 bg-white p-4 shadow-card sm:p-5">
      <div>
        <h2 className="text-[15px] font-semibold text-navy-900">Block a number or email</h2>
        <p className="mt-0.5 text-[13px] text-navy-500">It can never sign up, sign in, get an email code or be added to a profile. Any website account using it is banned at once.</p>
      </div>
      {errors.form && <Alert tone="danger">{errors.form}</Alert>}
      <div className="grid gap-3 sm:grid-cols-[150px_1fr]">
        <Field label="Type" htmlFor="bl-kind">
          <Select id="bl-kind" value={kind} onChange={(e) => setKind(e.target.value as "mobile" | "email")}>
            <option value="mobile">Mobile number</option>
            <option value="email">Email address</option>
          </Select>
        </Field>
        <Field label={kind === "mobile" ? "Mobile number" : "Email address"} htmlFor="bl-value" error={errors.value}>
          <Input id="bl-value" value={value} onChange={(e) => setValue(e.target.value)} inputMode={kind === "mobile" ? "tel" : "email"} placeholder={kind === "mobile" ? "98765 43210" : "name@example.com"} className="tabular" maxLength={200} />
        </Field>
      </div>
      <Field label="Reason" htmlFor="bl-reason" error={errors.reason} hint="Kept in the log. Not shown to the person.">
        <Input id="bl-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Called with a fake payment screenshot" />
      </Field>
      <Button type="submit" variant="danger" loading={busy} disabled={!value.trim() || reason.trim().length < 3} icon={<Ban className="h-4 w-4" />}>
        Block
      </Button>
    </form>
  );
}

/** Unblock one entry (with a reason, kept in the log). */
export function RemoveBlock({ id, value }: { id: string; value: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/blocklist/${id}/remove`, { body: { reason: reason.trim() } });
      toast(`${value} unblocked`);
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button size="sm" variant="outline" icon={<ShieldCheck className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Unblock
      </Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={`Unblock ${value}?`}
        description="It can be used to sign up again. An account that was banned with it stays banned until you lift that ban on the customer's record."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Back</Button>
            <Button loading={busy} disabled={reason.trim().length < 3} onClick={submit}>Unblock</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Reason" htmlFor={`ub-${id}`} required>
            <Textarea id={`ub-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
