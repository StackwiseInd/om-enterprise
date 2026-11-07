"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, ShieldOff, ShieldCheck, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";

/** Letters and digits that are easy to read out over the phone (no 0/O, 1/l/I). */
function suggestPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/** Staff actions on a website customer's account: set a new password, disable or re-enable. */
export function WebsiteCustomerActions({ id, name, active }: { id: string; name: string; active: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"password" | "status" | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(null);
    setError(null);
    setPassword("");
    setReason("");
    setCopied(false);
  };
  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/website-customers/${id}/${path}`, { body });
      toast(done);
      close();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" icon={<KeyRound className="h-4 w-4" />} onClick={() => setOpen("password")}>
        Set a new password
      </Button>
      {active ? (
        <Button variant="outline" icon={<ShieldOff className="h-4 w-4" />} onClick={() => setOpen("status")}>
          Disable account
        </Button>
      ) : (
        <Button variant="success" icon={<ShieldCheck className="h-4 w-4" />} loading={busy} onClick={() => call("status", { active: true }, "Account re-enabled")}>
          Re-enable account
        </Button>
      )}

      <Dialog
        open={open === "password"}
        onClose={close}
        title={`New password for ${name}`}
        description="For a customer who forgot theirs. They are signed out everywhere. Tell them the new password and ask them to keep it private; it is not stored anywhere you can read it later."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button disabled={password.length < 8} loading={busy} onClick={() => call("password", { password }, "New password set")}>
              Set password
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="New password" htmlFor="wc-pw" required hint="At least 8 characters.">
            <div className="flex gap-2">
              <Input id="wc-pw" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" spellCheck={false} className="tabular" />
              <Button type="button" variant="outline" icon={<Wand2 className="h-4 w-4" />} onClick={() => { setPassword(suggestPassword()); setCopied(false); }} aria-label="Suggest a password">
                Suggest
              </Button>
            </div>
          </Field>
          {password && (
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(password).then(() => setCopied(true)).catch(() => {})}
              className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-navy-700 hover:text-navy-950"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy to tell the customer"}
            </button>
          )}
        </div>
      </Dialog>

      <Dialog
        open={open === "status"}
        onClose={close}
        title={`Disable ${name}'s account?`}
        description="They are signed out everywhere and can't sign in or order until you re-enable it. Their past orders stay on record."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Back</Button>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={busy} onClick={() => call("status", { active: false, reason: reason.trim() }, "Account disabled")}>
              Disable account
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Reason" htmlFor="wc-reason" required hint="Kept in the account's history.">
            <Input id="wc-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Field>
        </div>
      </Dialog>
    </>
  );
}
