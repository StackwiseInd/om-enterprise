import { Suspense } from "react";
import Link from "next/link";
import { requirePageActor } from "@/server/auth/session";
import { listOnlineOrders } from "@/server/services/online-orders";
import { EmptyState, PageHeader, PageSkeleton, TableWrap } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { DateTime, Money } from "@/components/ui/money";
import { FilterBar } from "@/components/dashboard/ops/filter-bar";
import { str, type SearchParams } from "@/components/dashboard/ops/params";
import { codeLink, rowHover, tdMuted, tdNum, tdText, th, thNum } from "@/components/dashboard/table";
import { ONLINE_ORDER_STATUS } from "@/lib/online-order-status";
import type { OnlineOrderStatus } from "@/server/db/schema";

export const metadata = { title: "Online orders" };

export default function OnlineOrdersPage({ searchParams }: PageProps<"/dashboard/online-orders">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}

async function Orders({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requirePageActor(["orders.view", "payments.verify"]);
  const sp = await searchParams;
  const status = str(sp, "status") as OnlineOrderStatus | "to_verify" | undefined;
  const rows = await listOnlineOrders(actor, status || undefined);
  const toCheck = rows.filter((r) => r.o.status === "payment_submitted").length;

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Online orders"
        description="Paid online by UPI, collected at the store. A payment counts only after someone checks the credit in the shop's bank or UPI app."
      />
      <FilterBar
        fields={[
          {
            kind: "select",
            name: "status",
            label: "Status",
            options: [
              { value: "", label: "All" },
              { value: "to_verify", label: "Payment to check" },
              { value: "paid", label: "Paid" },
              { value: "ready", label: "Ready for pickup" },
              { value: "collected", label: "Collected" },
              { value: "awaiting_payment", label: "Waiting for payment" },
              { value: "payment_failed", label: "Payment not found" },
              { value: "cancelled", label: "Cancelled" },
              { value: "expired", label: "Expired" },
            ],
          },
        ]}
        values={{ status }}
      />
      {!status && toCheck > 0 && (
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-800">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          {toCheck} payment{toCheck === 1 ? "" : "s"} to check in the bank app.
        </p>
      )}
      {rows.length === 0 ? (
        <EmptyState title="No online orders" description="Orders customers pay for on the website appear here." />
      ) : (
        <TableWrap>
          <table className="stack-sm w-full min-w-[860px]">
            <thead>
              <tr>
                <th className={th}>Order</th>
                <th className={th}>Placed</th>
                <th className={th}>Customer</th>
                <th className={thNum}>Items</th>
                <th className={thNum}>To pay</th>
                <th className={th}>UTR</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ o, itemCount }) => (
                <tr key={o.id} className={o.status === "payment_submitted" ? "bg-amber-50/60 transition-colors hover:bg-amber-50" : rowHover}>
                  <td data-label="Order" className={tdText}>
                    <Link href={`/dashboard/online-orders/${o.id}`} className={codeLink}>
                      {o.orderNumber}
                    </Link>
                  </td>
                  <td data-label="Placed" className={`${tdMuted} whitespace-nowrap`}>
                    <DateTime value={o.createdAt} />
                  </td>
                  <td data-label="Customer" className={tdText}>
                    <div className="font-medium">{o.customerName}</div>
                    <div className="tabular text-xs text-navy-500">{o.mobile}</div>
                  </td>
                  <td data-label="Items" className={tdNum}>{itemCount}</td>
                  <td data-label="To pay" className={tdNum}>
                    <Money value={o.total} />
                    {o.couponCode && <div className="font-sans text-xs text-emerald-700">− {o.discount} ({o.couponCode})</div>}
                  </td>
                  <td data-label="UTR" className={`${tdText} tabular`}>{o.utr ?? <span className="text-navy-300">—</span>}</td>
                  <td data-label="Status" className={tdText}>
                    <Badge tone={ONLINE_ORDER_STATUS[o.status].tone}>{ONLINE_ORDER_STATUS[o.status].staff}</Badge>
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
