"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, Check, Copy, KeyRound, ShieldCheck, Snowflake, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";

/** Letters and digits that are easy to read out over the phone (no 0/O, 1/l/I). */
function suggestPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

/**
 * Staff actions on a website customer's account: set a new password; freeze / unfreeze (customers.edit);
 * ban / lift a ban and delete the account (customers.ban).
 */
export function WebsiteCustomerActions({
  id,
  name,
  status,
  canBan,
  phrase,
  hasEmail,
  hasAltMobile,
  deleteBlocked = null,
  requestId = null,
}: {
  id: string;
  name: string;
  status: "active" | "frozen" | "banned" | "deleted";
  canBan: boolean;
  /** The staff member's delete phrase ("Kishan-Deleting-This"). */
  phrase: string;
  hasEmail: boolean;
  hasAltMobile: boolean;
  /** Why the account can't be deleted yet (an order is paid and not handed over), or null. */
  deleteBlocked?: string | null;
  /** The customer's pending deletion request, if any. */
  requestId?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"password" | "freeze" | "ban" | "unban" | "delete" | null>(null);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [blockMobile, setBlockMobile] = useState(true);
  const [blockEmail, setBlockEmail] = useState(true);
  const [blockAlt, setBlockAlt] = useState(false);
  const [unblock, setUnblock] = useState(true);
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(null);
    setError(null);
    setPassword("");
    setReason("");
    setTyped("");
    setCopied(false);
    setAlsoBlock(false);
  };
  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/website-customers/${id}/${path}`, { body });
      toast(done);
      setBusy(false);
      setOpen(null);
      setReason("");
      setTyped("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  if (status === "deleted") return null;

  return (
    <>
      <Button variant="outline" icon={<KeyRound className="h-4 w-4" />} onClick={() => setOpen("password")}>
        Set a new password
      </Button>
      {status === "active" && (
        <Button variant="outline" icon={<Snowflake className="h-4 w-4" />} onClick={() => setOpen("freeze")}>
          Freeze
        </Button>
      )}
      {status === "frozen" && (
        <Button variant="success" icon={<ShieldCheck className="h-4 w-4" />} loading={busy && !open} onClick={() => call("status", { active: true }, "Account unfrozen")}>
          Unfreeze
        </Button>
      )}
      {canBan && status !== "banned" && (
        <Button variant="outline" className="text-red-700" icon={<Ban className="h-4 w-4" />} onClick={() => setOpen("ban")}>
          Ban
        </Button>
      )}
      {canBan && status === "banned" && (
        <Button variant="outline" icon={<ShieldCheck className="h-4 w-4" />} onClick={() => setOpen("unban")}>
          Lift ban
        </Button>
      )}
      {canBan && (
        <Button variant={requestId ? "danger" : "outline"} className={requestId ? undefined : "text-red-700"} icon={<Trash2 className="h-4 w-4" />} onClick={() => setOpen("delete")}>
          Delete account
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
        open={open === "freeze"}
        onClose={close}
        title={`Freeze ${name}'s account?`}
        description="On hold: they are signed out everywhere and can't sign in or order until you unfreeze it. Nothing is blocked or erased; their orders stay as they are."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Back</Button>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={busy} onClick={() => call("status", { active: false, reason: reason.trim() }, "Account frozen")}>
              Freeze account
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Reason" htmlFor="wc-reason" required hint="Kept in the account's history.">
            <Input id="wc-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Payment dispute being checked" />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={open === "ban"}
        onClose={close}
        title={`Ban ${name}?`}
        description="For fraud. They are signed out everywhere, can never sign in again, and their unpaid orders are closed. Paid orders stay for you to refund or hand over."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Back</Button>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={busy} icon={<Ban className="h-4 w-4" />} onClick={() => call("ban", { reason: reason.trim(), blockMobile, blockEmail, blockAltMobile: blockAlt }, "Account banned")}>
              Ban account
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Reason" htmlFor="wc-ban-reason" required hint="Kept in the log. Not shown to the customer.">
            <Textarea id="wc-ban-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} placeholder="e.g. Chargebacks on 3 orders; fake UPI screenshots" />
          </Field>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[13px] font-medium text-navy-700">Also block, so they can never sign up again with</legend>
            <Checkbox checked={blockMobile} onChange={(e) => setBlockMobile(e.target.checked)} label="Their mobile number" />
            {hasEmail && <Checkbox checked={blockEmail} onChange={(e) => setBlockEmail(e.target.checked)} label="Their email address" />}
            {hasAltMobile && <Checkbox checked={blockAlt} onChange={(e) => setBlockAlt(e.target.checked)} label="Their other phone number" />}
          </fieldset>
        </div>
      </Dialog>

      <Dialog
        open={open === "unban"}
        onClose={close}
        title={`Lift the ban on ${name}?`}
        description="They can sign in and order again."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Back</Button>
            <Button loading={busy} onClick={() => call("unban", { reason: reason.trim() || null, unblock }, "Ban lifted")}>
              Lift ban
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Reason (optional)" htmlFor="wc-unban-reason">
            <Input id="wc-unban-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </Field>
          <Checkbox checked={unblock} onChange={(e) => setUnblock(e.target.checked)} label="Also unblock the mobile number and email that were blocked with this ban" />
        </div>
      </Dialog>

      <Dialog
        open={open === "delete"}
        onClose={close}
        size="md"
        title={`Delete ${name}'s account?`}
        description={deleteBlocked ? undefined : "This can't be undone."}
        footer={
          deleteBlocked ? (
            <Button variant="ghost" onClick={close}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={close} disabled={busy}>Keep it</Button>
              <Button variant="danger" disabled={typed.trim() !== phrase} loading={busy} icon={<Trash2 className="h-4 w-4" />} onClick={() => call("delete", { confirm: typed.trim(), reason: reason.trim() || null, requestId, block: alsoBlock }, "Account deleted")}>
                Delete account
              </Button>
            </>
          )
        }
      >
        {deleteBlocked ? (
          <Alert tone="warning">{deleteBlocked}</Alert>
        ) : (
          <div className="space-y-4 text-sm text-navy-800">
            {error && <Alert tone="danger">{error}</Alert>}
            <ul className="list-disc space-y-1 pl-5 leading-relaxed">
              <li>Their name, mobile, email, address, business details and password are erased from the account, and they are signed out everywhere.</li>
              <li>Orders still waiting for payment are closed. Past orders stay, as the shop&apos;s sales record (tax law requires it).</li>
              <li>{requestId ? "Their deletion request is marked done." : "The mobile number can be used to sign up again, unless you block it below."}</li>
              <li>A record of the deletion, by whom and when, stays in the log.</li>
            </ul>
            <Checkbox checked={alsoBlock} onChange={(e) => setAlsoBlock(e.target.checked)} label="Fraud: also block their mobile number and email from ever signing up again" />
            <div>
              <p className="text-navy-700">To confirm, copy this and paste it below:</p>
              <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-navy-200 bg-paper px-3 py-2">
                <span className="select-all break-all font-semibold text-navy-950" data-testid="delete-phrase">{phrase}</span>
                <Button size="sm" variant="outline" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => navigator.clipboard?.writeText(phrase).then(() => toast("Copied — paste it below")).catch(() => {})}>
                  Copy
                </Button>
              </div>
            </div>
            <Field label="Paste it here" htmlFor={`wc-del-${id}`} error={typed && typed.trim() !== phrase ? "It doesn't match yet — it must be exactly the same." : null}>
              <Input id={`wc-del-${id}`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Reason (optional)" htmlFor={`wc-del-reason-${id}`} hint="Kept in the log.">
              <Textarea id={`wc-del-reason-${id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={2} />
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
