import { Suspense } from "react";
import Link from "next/link";
import { Download, ExternalLink } from "lucide-react";
import { requirePageActor } from "@/server/auth/session";
import { LOG_ACTION_LABEL, LOG_GROUPS, onlineOrderLogStats, queryOnlineOrderLog, type LogGroup } from "@/server/services/online-order-log";
import { ONLINE_ORDER_STATUS } from "@/lib/online-order-status";
import { formatPhone } from "@/lib/india";
import { PageHeader, PageSkeleton, TableWrap } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Stat } from "@/components/ui/card";
import { DateTime, Money } from "@/components/ui/money";
import { FilterBar } from "@/components/dashboard/ops/filter-bar";
import { Pagination } from "@/components/dashboard/ops/pagination";
import { str, type SearchParams } from "@/components/dashboard/ops/params";
import { rowHover, tdMuted, tdText, th } from "@/components/dashboard/table";
import { actorLabel } from "@/components/staff/labels";

export const metadata = { title: "Online orders log" };

const DOT: [RegExp, string][] = [
  [/deleted|refund_failed|signature_invalid|amount_mismatch|utr_rejected/, "bg-red-600"],
  [/cancel|expire|refund|late_payment|payment_failed/, "bg-amber-500"],
  [/payment_verified|confirmed|ready|collected|refunded$/, "bg-emerald-600"],
];
const dot = (action: string) => DOT.find(([re]) => re.test(action))?.[1] ?? "bg-navy-400";

export default function OnlineOrdersLogPage({ searchParams }: PageProps<"/admin/logs/online-orders">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Log searchParams={searchParams} />
    </Suspense>
  );
}

const istDay = (v: string | undefined, plusDay = false) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00+05:30`);
  return plusDay ? new Date(d.getTime() + 86400_000) : d;
};

async function Log({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requirePageActor("audit.view");
  const sp = await searchParams;
  const q = str(sp, "q") || undefined;
  const group = (str(sp, "group") || undefined) as LogGroup | undefined;
  const from = str(sp, "from") || undefined;
  const to = str(sp, "to") || undefined;
  const page = Math.max(1, Number(str(sp, "page")) || 1);
  const [res, stats] = await Promise.all([
    queryOnlineOrderLog(actor, { q, group: group && group in LOG_GROUPS ? group : undefined, from: istDay(from), to: istDay(to, true), page, pageSize: 50 }),
    onlineOrderLogStats(actor),
  ]);
  const csv = new URLSearchParams(Object.entries({ q, group, from, to }).filter((e): e is [string, string] => !!e[1]));

  return (
    <div>
      <PageHeader
        eyebrow="Admin · Logs"
        title="Online orders log"
        description="Every step of every website order, A to Z: placed, paid (and each check with Razorpay), confirmed, packed, handed over, cancelled, refunded and deleted. Who did it (customer, staff, Razorpay or the system), when, from where, and everything recorded. Entries can't be edited or removed; deleted orders stay here in full."
        actions={
          <>
            <Link href="/dashboard/online-orders" className={buttonClass("outline")}>
              Online orders
            </Link>
            <a href={`/api/admin/logs/online-orders?${csv.toString()}`} className={buttonClass("outline")}>
              <Download className="h-4 w-4" /> Download CSV
            </a>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Events recorded" value={stats.events.toLocaleString("en-IN")} hint="All time" />
        <Stat label="Today" value={stats.today.toLocaleString("en-IN")} hint="Since midnight (IST)" tone="green" />
        <Stat label="Cancellations with refund" value={stats.refunds.toLocaleString("en-IN")} tone="gold" hint="By customers, staff or automatic" />
        <Stat label="Orders deleted" value={stats.deleted.toLocaleString("en-IN")} tone="red" hint="Kept here in full" />
      </div>
      <FilterBar
        fields={[
          { kind: "search", name: "q", placeholder: "Order number, customer, mobile, email, payment ID / UTR, staff name" },
          { kind: "select", name: "group", label: "What", options: [{ value: "", label: "Everything" }, ...Object.entries(LOG_GROUPS).map(([value, g]) => ({ value, label: g.label }))] },
          { kind: "date", name: "from", label: "From" },
          { kind: "date", name: "to", label: "To" },
        ]}
        values={{ q, group, from, to }}
      />
      <TableWrap>
        <table className="stack-sm w-full min-w-[900px]">
          <thead>
            <tr>
              <th className={th}>When</th>
              <th className={th}>Order</th>
              <th className={th}>Step</th>
              <th className={th}>What happened</th>
              <th className={th}>By</th>
            </tr>
          </thead>
          <tbody>
            {res.items.map((e) => {
              const snap = (e.data as { order?: { orderNumber?: string; customerName?: string; mobile?: string; total?: string } } | null)?.order;
              const number = e.orderNumber ?? snap?.orderNumber ?? null;
              return (
                <tr key={e.id} className={`${rowHover} align-top`}>
                  <td data-label="When" className={`${tdMuted} whitespace-nowrap text-xs`}>
                    <DateTime value={e.at} />
                  </td>
                  <td data-label="Order" className={tdText}>
                    {number ? (
                      <div className="flex flex-col gap-1">
                        {e.orderId && !e.deletedAt ? (
                          <Link href={`/dashboard/online-orders/${e.orderId}`} className="inline-flex items-center gap-1 tabular font-semibold text-navy-950 underline-offset-[3px] hover:underline">
                            {number} <ExternalLink className="h-3 w-3 text-navy-400" />
                          </Link>
                        ) : (
                          <Link href={`?q=${number}`} className="tabular font-semibold text-navy-950 underline-offset-[3px] hover:underline">
                            {number}
                          </Link>
                        )}
                        <span className="text-xs text-navy-600">
                          {e.customerName ?? snap?.customerName}
                          {(e.mobile ?? snap?.mobile) ? <span className="block whitespace-nowrap tabular">{formatPhone((e.mobile ?? snap?.mobile)!)}</span> : null}
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5 text-xs">
                          {e.total && <Money value={e.total} className="font-medium" />}
                          {e.deletedAt ? <Badge tone="red">Deleted</Badge> : e.status ? <Badge tone={ONLINE_ORDER_STATUS[e.status].tone}>{ONLINE_ORDER_STATUS[e.status].staff}</Badge> : null}
                        </span>
                      </div>
                    ) : (
                      <span className="text-navy-300">—</span>
                    )}
                  </td>
                  <td data-label="Step" className={tdText}>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium text-navy-900">
                      <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(e.action)}`} />
                      {LOG_ACTION_LABEL[e.action] ?? e.action}
                    </span>
                    <div className="mt-0.5 tabular text-[11px] text-navy-400">{e.action}</div>
                  </td>
                  <td data-label="What happened" className={tdText}>
                    <div className="leading-snug">{e.summary}</div>
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-navy-500 transition-colors hover:text-navy-900">All details</summary>
                      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
                        <dt className="text-navy-500">Entry</dt>
                        <dd className="tabular">#{e.id}</dd>
                        {e.ip && (
                          <>
                            <dt className="text-navy-500">IP</dt>
                            <dd className="tabular">{e.ip}</dd>
                          </>
                        )}
                        {e.userAgent && (
                          <>
                            <dt className="text-navy-500">Device</dt>
                            <dd className="break-all">{e.userAgent}</dd>
                          </>
                        )}
                      </dl>
                      {e.data != null && <pre className="mt-1.5 max-h-80 overflow-auto rounded-md border border-rule bg-paper/70 p-2.5 tabular text-[11px] leading-snug text-navy-800">{JSON.stringify(e.data, null, 2)}</pre>}
                    </details>
                  </td>
                  <td data-label="By" className={`${tdText} text-xs`}>
                    <div className="font-semibold">{actorLabel(e.actorLabel)}</div>
                    <div className="mt-0.5 text-[11px] text-navy-500">{e.actorUserId ? "Staff" : /^customer /.test(e.actorLabel) ? "Customer" : /razorpay/i.test(e.actorLabel) ? "Razorpay" : "System"}</div>
                  </td>
                </tr>
              );
            })}
            {!res.items.length && (
              <tr>
                <td className={tdMuted} colSpan={5}>
                  Nothing in the log matches these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableWrap>
      <Pagination total={res.total} page={page} pageSize={res.pageSize} sp={sp} basePath="/admin/logs/online-orders" />
    </div>
  );
}
