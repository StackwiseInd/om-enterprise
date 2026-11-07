"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";

/**
 * "Delete" for the Super Admin: a sale (with its bills and quotations) or a single quotation. The
 * dialog says what will happen and only deletes once the Super Admin's phrase ("Kishan-Deleting-This")
 * is pasted in exactly; the server checks the phrase again.
 */
export function DeleteRecord({
  kind,
  id,
  name,
  phrase,
  consequences,
  afterDelete,
  compact,
  size = "md",
  blocked,
}: {
  kind: "sale" | "quotation" | "online_order";
  id: string;
  /** What is being deleted, as people know it: "S000019", "QT/26-27/00003". */
  name: string;
  phrase: string;
  /** What else happens, one line each (bills cancelled, money received…). */
  consequences: string[];
  /** Where to go after deleting; without it the current page reloads. */
  afterDelete?: string;
  /** A small icon button, for a row in a list. */
  compact?: boolean;
  size?: "sm" | "md";
  /** Why this can't be deleted (a paid sale); the dialog then explains instead of asking for the phrase. */
  blocked?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === phrase;
  const noun = { sale: "sale", quotation: "quotation", online_order: "online order" }[kind];
  const label = `Delete ${noun} ${name}`;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setTyped("");
    setReason("");
    setError(null);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(phrase);
      toast("Copied — paste it in the box below");
    } catch {
      toast("Copy did not work here — type it instead", "error");
    }
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = { sale: `/api/sales/${id}/delete`, quotation: `/api/documents/${id}/delete`, online_order: `/api/admin/online-orders/${id}/delete` }[kind];
      await apiFetch(path, { method: "POST", body: { confirm: typed.trim(), reason: reason.trim() || null } });
      toast(`${name} deleted`);
      setOpen(false);
      if (afterDelete) router.push(afterDelete);
      else router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {compact ? (
        <button
          type="button"
          title={label}
          aria-label={label}
          onClick={() => setOpen(true)}
          className="rounded-md p-1.5 text-navy-400 transition-colors hover:bg-red-50 hover:text-red-700"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : (
        <Button variant="outline" size={size} className="text-red-700" icon={<Trash2 className="h-4 w-4" />} onClick={() => setOpen(true)}>
          Delete {noun}
        </Button>
      )}
      <Dialog
        open={open}
        onClose={close}
        size="md"
        title={`${label}?`}
        description={blocked ? undefined : "Only the Super Admin can do this. It can't be undone."}
        footer={
          blocked ? (
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>
                Keep it
              </Button>
              <Button variant="danger" loading={busy} disabled={!matches} icon={<Trash2 className="h-4 w-4" />} onClick={submit}>
                Delete {name}
              </Button>
            </>
          )
        }
      >
        {blocked ? (
          <Alert tone="warning">{blocked}</Alert>
        ) : (
          <div className="space-y-4 text-sm text-navy-800">
            {error && <Alert tone="danger">{error}</Alert>}
            <ul className="list-disc space-y-1 pl-5 leading-relaxed">
              <li>
                {kind === "sale"
                  ? `${name} disappears from sales, bills, payments, customers and reports.`
                  : kind === "online_order"
                    ? `${name} disappears from online orders, the customer's My orders, customer totals and the dashboard.`
                    : `${name} disappears from the sale and the documents list, and its share link stops working.`}
              </li>
              {consequences.map((c) => (
                <li key={c}>{c}</li>
              ))}
              <li>{kind === "online_order" ? "Everything on the order (items, payment, customer, history) stays in the online orders log, with who deleted it, when and why." : "A record of what was deleted, by whom and when stays in the audit log."}</li>
            </ul>
            <div>
              <p className="text-navy-700">To confirm, copy this and paste it below:</p>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-navy-200 bg-paper px-3 py-2">
                <span className="select-all break-all font-semibold text-navy-950" data-testid="delete-phrase">
                  {phrase}
                </span>
                <Button size="sm" variant="outline" icon={<Copy className="h-3.5 w-3.5" />} onClick={copy}>
                  Copy
                </Button>
              </div>
            </div>
            <Field label="Paste it here" htmlFor={`delete-${id}`} error={typed && !matches ? "It doesn't match yet — it must be exactly the same." : null}>
              <Input id={`delete-${id}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
            </Field>
            <Field label="Reason (optional)" htmlFor={`delete-reason-${id}`} hint="Recorded in the audit log.">
              <Textarea id={`delete-reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} />
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
