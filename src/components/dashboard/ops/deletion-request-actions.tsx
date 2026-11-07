"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";

/** Complete (delete the account) or turn down one customer's deletion request. */
export function DeletionRequestActions({ requestId, accountId, name, phrase, blocked }: { requestId: string; accountId: string; name: string; phrase: string; blocked: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"delete" | "reject" | null>(null);
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (busy) return;
    setOpen(null);
    setTyped("");
    setNote("");
    setError(null);
  };
  const run = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(path, { body });
      toast(done);
      setBusy(false);
      setOpen(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => setOpen("delete")}>
        Delete account
      </Button>
      <Button size="sm" variant="outline" icon={<XCircle className="h-3.5 w-3.5" />} onClick={() => setOpen("reject")}>
        Turn down
      </Button>

      <Dialog
        open={open === "delete"}
        onClose={close}
        size="md"
        title={`Delete ${name}'s account?`}
        description={blocked ? undefined : "As the customer asked. This can't be undone."}
        footer={
          blocked ? (
            <Button variant="ghost" onClick={close}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>Back</Button>
              <Button variant="danger" disabled={typed.trim() !== phrase} loading={busy} icon={<Trash2 className="h-4 w-4" />} onClick={() => run(`/api/admin/website-customers/${accountId}/delete`, { confirm: typed.trim(), requestId, reason: note.trim() || null, block: alsoBlock }, "Account deleted")}>
                Delete account
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
              <li>Name, mobile, email, address, business details and password are erased; they are signed out everywhere.</li>
              <li>Unpaid orders are closed. Past orders stay as the shop&apos;s sales record (tax law requires it).</li>
              <li>The request is marked done, and the deletion stays in the log.</li>
            </ul>
            <Checkbox checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} label="Fraud: also block their mobile and email from ever signing up again" />
            <div>
              <p className="text-navy-700">To confirm, copy this and paste it below:</p>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-navy-200 bg-paper px-3 py-2">
                <span className="select-all break-all font-semibold text-navy-950" data-testid="delete-phrase">{phrase}</span>
                <Button size="sm" variant="outline" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard?.writeText(phrase).then(() => toast("Copied — paste it below")).catch(() => {})}>
                  Copy
                </Button>
              </div>
            </div>
            <Field label="Paste it here" htmlFor={`dr-${requestId}`} error={typed && typed.trim() !== phrase ? "It doesn't match yet — it must be exactly the same." : null}>
              <Input id={`dr-${requestId}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Note (optional)" htmlFor={`dr-note-${requestId}`} hint="Kept in the log.">
              <Input id={`dr-note-${requestId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
          </div>
        )}
      </Dialog>

      <Dialog
        open={open === "reject"}
        onClose={close}
        title={`Turn down ${name}'s request?`}
        description="The account stays as it is. Tell the customer why (for example, a paid order still to collect, or the request didn't come from them)."
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>Back</Button>
            <Button disabled={note.trim().length < 3} loading={busy} onClick={() => run(`/api/admin/deletion-requests/${requestId}/reject`, { note: note.trim() }, "Request turned down")}>
              Turn down
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Reason" htmlFor={`dr-rej-${requestId}`} required>
            <Textarea id={`dr-rej-${requestId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
