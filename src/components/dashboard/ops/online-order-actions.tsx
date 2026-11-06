"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, PackageCheck, PackageOpen, RefreshCw, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { useToast } from "@/components/ui/toast";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { formatPrice } from "@/lib/money";
import type { OnlineOrderStatus } from "@/server/db/schema";

/** Staff actions on an online order: check the payment, then hand the items over. */
export function OnlineOrderActions({
  id,
  status,
  total,
  utr,
  orderNumber,
  canVerify,
  canManage,
  gateway = false,
  canRefund = false,
  refundState = null,
}: {
  id: string;
  status: OnlineOrderStatus;
  total: string;
  utr: string | null;
  orderNumber: string;
  canVerify: boolean;
  canManage: boolean;
  /** Paid through PhonePe (confirmed automatically; refunds go back through PhonePe). */
  gateway?: boolean;
  canRefund?: boolean;
  refundState?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<"verify" | "fail" | "cancel" | "refund" | null>(null);
  const [note, setNote] = useState("");
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/online-orders/${id}/${path}`, { body });
      toast(done);
      setOpen(null);
      setNote("");
      setSeen(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(null);
    setError(null);
  };

  return (
    <div className="space-y-3">
      {gateway && status === "awaiting_payment" && (
        <>
          <p className="text-sm text-navy-600">Waiting for the customer to pay on PhonePe. PhonePe&apos;s answer marks the order paid by itself.</p>
          <Button variant="outline" icon={<RefreshCw className="h-4 w-4" />} loading={busy} onClick={() => call("check", {}, "Checked with PhonePe")}>
            Check with PhonePe now
          </Button>
        </>
      )}
      {gateway && (status === "paid" || status === "ready") && canRefund && (
        <Button variant="outline" icon={<Undo2 className="h-4 w-4" />} onClick={() => setOpen("refund")}>
          Cancel and refund
        </Button>
      )}
      {gateway && status === "refunding" && (
        <>
          <p className="text-sm text-navy-600">{refundState === "FAILED" ? "PhonePe could not complete the refund. Retry it below." : "The refund is with PhonePe. This page shows when it completes."}</p>
          {refundState === "FAILED" && canRefund && (
            <Button icon={<Undo2 className="h-4 w-4" />} loading={busy} onClick={() => call("refund", { reason: "" }, "Refund sent to PhonePe again")}>
              Retry refund
            </Button>
          )}
        </>
      )}
      {status === "payment_submitted" && canVerify && (
        <>
          <Alert tone="warning">
            {gateway ? (
              <>
                PhonePe reported a different amount than the order total of <strong>{formatPrice(total)}</strong>. Check this order in the PhonePe Business dashboard; verify only if the full amount was received, otherwise mark it not found.
              </>
            ) : (
              <>
                Open the shop&apos;s bank or UPI business app and look for <strong>{formatPrice(total)}</strong> with UTR <strong className="tabular">{utr}</strong>. Only verify once you can see that credit.
              </>
            )}
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Button variant="success" icon={<BadgeCheck className="h-4 w-4" />} onClick={() => setOpen("verify")}>
              Payment received
            </Button>
            <Button variant="outline" icon={<XCircle className="h-4 w-4" />} onClick={() => setOpen("fail")}>
              Not found
            </Button>
          </div>
        </>
      )}
      {status === "paid" && canManage && (
        <Button icon={<PackageOpen className="h-4 w-4" />} onClick={() => call("status", { status: "ready" }, "Marked ready for pickup")} loading={busy}>
          Ready for pickup
        </Button>
      )}
      {(status === "paid" || status === "ready") && canManage && (
        <Button variant={status === "ready" ? "primary" : "outline"} icon={<PackageCheck className="h-4 w-4" />} onClick={() => call("status", { status: "collected" }, "Marked collected")} loading={busy}>
          Handed over (collected)
        </Button>
      )}
      {["awaiting_payment", "payment_submitted", "payment_failed"].includes(status) && canManage && (
        <button type="button" onClick={() => setOpen("cancel")} className="block text-sm font-medium text-navy-500 underline-offset-4 hover:text-red-700 hover:underline">
          Cancel this order
        </button>
      )}
      {error && !open && <Alert tone="danger">{error}</Alert>}

      <Dialog
        open={open === "verify"}
        onClose={close}
        title={`Verify payment for ${orderNumber}`}
        description={`Confirm that ${formatPrice(total)}${utr ? ` with UTR ${utr}` : ""} has reached the shop's account.`}
        footer={
          <>
            <Button variant="ghost" onClick={close}>Back</Button>
            <Button variant="success" disabled={!seen} loading={busy} onClick={() => call("verify", { note: note || null }, "Payment verified — the customer sees “Order placed”")}>
              Verify payment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <Checkbox
            checked={seen}
            onChange={(e) => setSeen(e.target.checked)}
            label={
              <span>
                I can see <strong>{formatPrice(total)}</strong> received{utr ? <> with UTR <strong className="tabular">{utr}</strong></> : null} in the shop&apos;s {gateway ? "PhonePe Business dashboard" : "bank / UPI app"}.
              </span>
            }
          />
          <Field label="Note (optional)" htmlFor="v-note" hint="e.g. which app you checked.">
            <Input id="v-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={open === "fail"}
        onClose={close}
        title={`Payment not found for ${orderNumber}`}
        description="The customer sees “Payment not found” with your reason. Any discount code goes back into use."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Back</Button>
            <Button variant="danger" disabled={note.trim().length < 3} loading={busy} onClick={() => call("fail", { reason: note.trim() }, "Marked as payment not found")}>
              Mark not found
            </Button>
          </>
        }
      >
        {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
        <Field label="Reason shown to the customer" htmlFor="f-reason" required>
          <Textarea id="f-reason" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="No credit with this UTR in the bank app. Please check the number or contact us." />
        </Field>
      </Dialog>

      <Dialog
        open={open === "refund"}
        onClose={close}
        title={`Cancel ${orderNumber} and refund ${formatPrice(total)}?`}
        description="The full amount goes back through PhonePe to the account the customer paid from. The customer sees the reason."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Back</Button>
            <Button variant="danger" disabled={note.trim().length < 3} loading={busy} onClick={() => call("refund", { reason: note.trim() }, "Refund sent to PhonePe")}>
              Cancel and refund
            </Button>
          </>
        }
      >
        {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
        <Field label="Reason" htmlFor="r-reason" required>
          <Input id="r-reason" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. Item out of stock" />
        </Field>
      </Dialog>

      <Dialog
        open={open === "cancel"}
        onClose={close}
        title={`Cancel ${orderNumber}?`}
        description="Only for orders that are not paid. Any discount code goes back into use."
        footer={
          <>
            <Button variant="ghost" onClick={close}>Back</Button>
            <Button variant="danger" disabled={!note.trim()} loading={busy} onClick={() => call("status", { status: "cancelled", reason: note.trim() }, "Order cancelled")}>
              Cancel order
            </Button>
          </>
        }
      >
        {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
        <Field label="Reason" htmlFor="c-reason" required>
          <Input id="c-reason" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
      </Dialog>
    </div>
  );
}
