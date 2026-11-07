import { Suspense } from "react";
import Link from "next/link";
import { UserX, Users } from "lucide-react";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/auth/actor";
import { listBlocklist } from "@/server/services/shop-moderation";
import { formatPhone } from "@/lib/india";
import { SHOP_ACCOUNT_STATUS } from "@/lib/shop-account-status";
import { EmptyState, PageHeader, PageSkeleton, TableWrap } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DateTime } from "@/components/ui/money";
import { FilterBar } from "@/components/dashboard/ops/filter-bar";
import { str, type SearchParams } from "@/components/dashboard/ops/params";
import { rowHover, tdMuted, tdText, th } from "@/components/dashboard/table";
import { AddBlock, RemoveBlock } from "@/components/dashboard/ops/blocklist-actions";

export const metadata = { title: "Blocked numbers & emails" };

export default function BlocklistPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Blocklist searchParams={searchParams} />
    </Suspense>
  );
}

async function Blocklist({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requirePageActor("customers.view");
  const sp = await searchParams;
  const q = str(sp, "q");
  const rawShow = str(sp, "show");
  const show = rawShow === "removed" || rawShow === "all" ? rawShow : "active";
  const rows = await listBlocklist(actor, { q, show });
  const canAct = can(actor, "customers.ban");

  return (
    <div>
      <PageHeader
        eyebrow="Admin · Online customers"
        title="Blocked numbers & emails"
        description="Mobile numbers and email addresses that can never sign up or sign in on the website, for fraud. Banning a customer blocks theirs; you can also block one on its own (say, a number that called with a fake payment). Every attempt to use a blocked one is counted and logged."
        actions={
          <>
            <Link href="/dashboard/website-customers" className={buttonClass("outline")}>
              <Users className="h-4 w-4" /> Online customers
            </Link>
            <Link href="/admin/delete-request/online-orders" className={buttonClass("outline")}>
              <UserX className="h-4 w-4" /> Deletion requests
            </Link>
          </>
        }
      />
      {canAct && (
        <div className="mb-6 max-w-2xl">
          <AddBlock />
        </div>
      )}
      <FilterBar
        fields={[
          { kind: "search", name: "q", placeholder: "Number, email or reason" },
          {
            kind: "select",
            name: "show",
            label: "Show",
            options: [
              { value: "", label: "Blocked now" },
              { value: "removed", label: "Unblocked" },
              { value: "all", label: "All" },
            ],
          },
        ]}
        values={{ q, show: show === "active" ? undefined : show }}
      />
      {rows.length === 0 ? (
        <EmptyState title={show === "active" ? "Nothing blocked" : "Nothing here"} description="Blocked mobile numbers and email addresses appear here." />
      ) : (
        <TableWrap>
          <table className="stack-sm w-full min-w-[900px]">
            <thead>
              <tr>
                <th className={th}>Blocked</th>
                <th className={th}>Reason</th>
                <th className={th}>Account</th>
                <th className={th}>Tries since</th>
                <th className={th}>Blocked by</th>
                <th className={th}>{show === "active" ? "" : "Status"}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ b, createdByName, removedByName, accountName, accountStatus }) => (
                <tr key={b.id} className={`${rowHover} align-top`}>
                  <td data-label="Blocked" className={tdText}>
                    <div className="whitespace-nowrap tabular font-semibold text-navy-950">{b.kind === "mobile" ? formatPhone(b.value) : b.value}</div>
                    <div className="mt-0.5 text-xs text-navy-500">{b.kind === "mobile" ? "Mobile number" : "Email address"}</div>
                  </td>
                  <td data-label="Reason" className={`${tdText} text-[13px] leading-snug`}>{b.reason}</td>
                  <td data-label="Account" className={tdText}>
                    {b.accountId ? (
                      <>
                        <Link href={`/dashboard/website-customers/${b.accountId}`} className="text-[13px] font-semibold text-navy-900 underline-offset-[3px] hover:underline">
                          {accountName}
                        </Link>
                        {accountStatus && <Badge tone={SHOP_ACCOUNT_STATUS[accountStatus].tone} className="ml-1.5">{SHOP_ACCOUNT_STATUS[accountStatus].label}</Badge>}
                      </>
                    ) : (
                      <span className="text-xs text-navy-500">Blocked on its own</span>
                    )}
                  </td>
                  <td data-label="Tries since" className={tdText}>
                    <span className={b.hits ? "font-semibold text-red-700" : "text-navy-400"}>{b.hits}</span>
                    {b.lastHitAt && <div className="mt-0.5 text-xs text-navy-500">Last <DateTime value={b.lastHitAt} /></div>}
                  </td>
                  <td data-label="Blocked by" className={`${tdMuted} text-xs`}>
                    <DateTime value={b.createdAt} />
                    {createdByName && <div>{createdByName}</div>}
                  </td>
                  <td data-label="" className={tdText}>
                    {b.removedAt ? (
                      <div className="text-xs text-navy-600">
                        <Badge tone="neutral">Unblocked</Badge>
                        <div className="mt-1">
                          <DateTime value={b.removedAt} />
                          {removedByName && <> · {removedByName}</>}
                        </div>
                        {b.removeReason && <div className="mt-0.5 text-navy-500">{b.removeReason}</div>}
                      </div>
                    ) : canAct ? (
                      <RemoveBlock id={b.id} value={b.kind === "mobile" ? formatPhone(b.value) : b.value} />
                    ) : null}
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
