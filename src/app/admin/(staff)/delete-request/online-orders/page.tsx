import { Suspense } from "react";
import Link from "next/link";
import { Ban, Users } from "lucide-react";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/auth/actor";
import { DELETION_STATUSES, deleteBlockedFor, deletionRequestCounts, listDeletionRequests } from "@/server/services/shop-moderation";
import { deletePhrase } from "@/lib/delete-phrase";
import { formatPhone } from "@/lib/india";
import { SHOP_ACCOUNT_STATUS } from "@/lib/shop-account-status";
import type { DeletionRequestStatus } from "@/server/db/schema";
import { EmptyState, PageHeader, PageSkeleton, TableWrap } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Stat } from "@/components/ui/card";
import { DateTime } from "@/components/ui/money";
import { FilterBar } from "@/components/dashboard/ops/filter-bar";
import { str, type SearchParams } from "@/components/dashboard/ops/params";
import { rowHover, tdMuted, tdText, th } from "@/components/dashboard/table";
import { DeletionRequestActions } from "@/components/dashboard/ops/deletion-request-actions";

export const metadata = { title: "Account deletion requests" };

const STATUS: Record<DeletionRequestStatus, { label: string; tone: "amber" | "neutral" | "red" | "green" }> = {
  pending: { label: "Waiting", tone: "amber" },
  completed: { label: "Deleted", tone: "neutral" },
  rejected: { label: "Turned down", tone: "red" },
  withdrawn: { label: "Withdrawn by customer", tone: "neutral" },
};

export default function DeletionRequestsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Requests searchParams={searchParams} />
    </Suspense>
  );
}

async function Requests({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requirePageActor("customers.view");
  const sp = await searchParams;
  const raw = str(sp, "status");
  const status = raw === "all" || (DELETION_STATUSES as string[]).includes(raw ?? "") ? (raw as DeletionRequestStatus | "all") : "pending";
  const q = str(sp, "q");
  const [rows, counts] = await Promise.all([listDeletionRequests(actor, { status, q }), deletionRequestCounts()]);
  const canAct = can(actor, "customers.ban");
  const blockedBy = new Map<string, string | null>();
  if (canAct) for (const r of rows.filter((x) => x.r.status === "pending")) blockedBy.set(r.r.accountId, await deleteBlockedFor(r.r.accountId));

  return (
    <div>
      <PageHeader
        eyebrow="Admin · Online customers"
        title="Account deletion requests"
        description="Customers ask from My profile on the website, confirming with their password. Deleting erases their name, mobile, email, address and password and signs them out; their past orders stay as the shop's sales record. A request can't be completed while one of their orders is paid and not yet handed over or refunded."
        actions={
          <>
            <Link href="/dashboard/website-customers" className={buttonClass("outline")}>
              <Users className="h-4 w-4" /> Online customers
            </Link>
            <Link href="/admin/blocklist" className={buttonClass("outline")}>
              <Ban className="h-4 w-4" /> Blocked numbers &amp; emails
            </Link>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Waiting" value={counts.pending.toLocaleString("en-IN")} tone={counts.pending ? "red" : "navy"} hint={counts.pending ? "Please handle these" : "Nothing waiting"} />
        <Stat label="Deleted" value={counts.completed.toLocaleString("en-IN")} hint="Accounts erased on request" />
        <Stat label="Turned down" value={counts.rejected.toLocaleString("en-IN")} />
        <Stat label="Withdrawn" value={counts.withdrawn.toLocaleString("en-IN")} hint="Customer changed their mind" />
      </div>
      <FilterBar
        fields={[
          { kind: "search", name: "q", placeholder: "Name, mobile or email" },
          {
            kind: "select",
            name: "status",
            label: "Show",
            options: [
              { value: "", label: `Waiting (${counts.pending})` },
              { value: "completed", label: "Deleted" },
              { value: "rejected", label: "Turned down" },
              { value: "withdrawn", label: "Withdrawn" },
              { value: "all", label: "All requests" },
            ],
          },
        ]}
        values={{ q, status: status === "pending" ? undefined : status }}
      />
      {rows.length === 0 ? (
        <EmptyState title={status === "pending" ? "No requests waiting" : "No requests here"} description="When a customer asks for their account to be deleted, it appears here." />
      ) : (
        <TableWrap>
          <table className="stack-sm w-full min-w-[980px]">
            <thead>
              <tr>
                <th className={th}>Customer</th>
                <th className={th}>Asked</th>
                <th className={th}>Their reason</th>
                <th className={th}>Orders</th>
                <th className={th}>Status</th>
                <th className={th}>{status === "pending" ? "Action" : "Handled"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ r, decidedByName, accountStatus, orders, openOrders }) => (
                <tr key={r.id} className={`${rowHover} align-top`}>
                  <td data-label="Customer" className={tdText}>
                    {r.status === "completed" ? (
                      <span className="font-semibold text-navy-700">{r.name}</span>
                    ) : (
                      <Link href={`/dashboard/website-customers/${r.accountId}`} className="font-semibold text-navy-950 underline-offset-[3px] hover:underline">
                        {r.name}
                      </Link>
                    )}
                    <div className="mt-0.5 whitespace-nowrap tabular text-xs text-navy-600">{/^\d{10}$/.test(r.mobile) ? formatPhone(r.mobile) : r.mobile}</div>
                    {r.email && <div className="mt-0.5 break-all text-xs text-navy-500">{r.email}</div>}
                    {accountStatus && accountStatus !== "active" && accountStatus !== "deleted" && <Badge tone={SHOP_ACCOUNT_STATUS[accountStatus].tone} className="mt-1">{SHOP_ACCOUNT_STATUS[accountStatus].label}</Badge>}
                  </td>
                  <td data-label="Asked" className={`${tdMuted} whitespace-nowrap text-xs`}>
                    <DateTime value={r.requestedAt} />
                  </td>
                  <td data-label="Their reason" className={tdText}>
                    {r.reason ? <span className="text-[13px] leading-snug">“{r.reason}”</span> : <span className="text-navy-300">—</span>}
                  </td>
                  <td data-label="Orders" className={tdText}>
                    <span className="text-[13px]">{orders}</span>
                    {openOrders > 0 && <div className="mt-0.5 text-xs font-medium text-amber-800">{openOrders} paid, not handed over</div>}
                  </td>
                  <td data-label="Status" className={tdText}>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </td>
                  <td data-label={status === "pending" ? "Action" : "Handled"} className={tdText}>
                    {r.status === "pending" ? (
                      canAct ? (
                        <DeletionRequestActions requestId={r.id} accountId={r.accountId} name={r.name} phrase={deletePhrase(actor.username)} blocked={blockedBy.get(r.accountId) ?? null} />
                      ) : (
                        <span className="text-xs text-navy-500">Needs the ban / delete permission</span>
                      )
                    ) : (
                      <div className="text-xs text-navy-600">
                        {r.decidedAt && <DateTime value={r.decidedAt} />}
                        {decidedByName && <> · {decidedByName}</>}
                        {r.decisionNote && <div className="mt-0.5 text-navy-500">{r.decisionNote}</div>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );
}
