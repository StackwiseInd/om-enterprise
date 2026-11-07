import { Suspense } from "react";
import Link from "next/link";
import { ArrowRight, BadgeCheck, Globe, Plus, ReceiptText, Wallet } from "lucide-react";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/auth/actor";
import { getSettings } from "@/server/settings";
import { bestSellers, salesByDay, salesSummary } from "@/server/services/reports";
import { listPendingApprovals, listSales } from "@/server/services/sales";
import { countPendingPriceChanges } from "@/server/services/pricing";
import { newOrderCount } from "@/server/services/website-orders";
import { istStartOfDay, istStartOfMonth } from "@/lib/india";
import { D, formatINR } from "@/lib/money";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { Alert, EmptyState, PageHeader, PageSkeleton, TableWrap } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { Money, DateTime, Qty } from "@/components/ui/money";
import { StatusBadge } from "@/components/ui/badge";
import { CASH_SALE, TrainingBadge, plural } from "@/components/staff/labels";
import { SalesChart, type DayPoint } from "@/components/dashboard/ops/sales-chart";
import { OnlineCustomersCard } from "@/components/dashboard/online-customers-card";
import { istDateKey } from "@/components/dashboard/ops/params";
import { rowHover, tdNum, tdText, th, thNum } from "@/components/dashboard/table";

export const metadata = { title: "Overview" };

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

async function Overview() {
  const actor = await requirePageActor("dashboard.view");
  const now = new Date();
  const dayStart = istStartOfDay(now);
  const tomorrow = new Date(dayStart.getTime() + 86400_000);
  const monthStart = istStartOfMonth(now);
  const chartStart = new Date(dayStart.getTime() - 29 * 86400_000);

  const tax = await getSettings("tax");
  const payments = await getSettings("payments");
  const canReports = can(actor, "reports.view");
  const canProfit = can(actor, "reports.profit") && can(actor, "costs.view");

  const today = canReports ? await salesSummary(actor, { from: dayStart, to: tomorrow }) : null;
  const month = canReports ? await salesSummary(actor, { from: monthStart, to: tomorrow }) : null;
  const daily = canReports ? await salesByDay(actor, { from: chartStart, to: tomorrow }) : [];
  const best = canReports ? await bestSellers(actor, { from: monthStart, to: tomorrow }, 5) : [];

  const pendingDiscounts = can(actor, "discounts.approve") ? (await listPendingApprovals(actor)).length : 0;
  const pendingPrices = can(actor, "prices.approve") ? await countPendingPriceChanges() : 0;
  const newOrders = can(actor, "orders.view") ? await newOrderCount() : 0;
  const canSales = can(actor, "sales.view_all") || can(actor, "sales.create");
  const recent = canSales ? await listSales(actor, { pageSize: 6 }) : null;
  const withTraining = canSales ? await listSales(actor, { pageSize: 1, includeTraining: true }) : null;
  const hiddenTraining = recent && withTraining ? withTraining.total - recent.total : 0;

  const points: DayPoint[] = Array.from({ length: 30 }, (_, i) => {
    const key = istDateKey(new Date(chartStart.getTime() + i * 86400_000));
    const row = daily.find((d) => d.day === key);
    return { day: key, value: row ? Number(row.taxable) : 0, bills: row ? row.bills : 0 };
  });
  const thirtyDayTotal = points.reduce((a, p) => a.plus(p.value), D(0));

  const todayLabel = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={todayLabel}
        title="Overview"
        description="Live figures from saved bills and verified payments. Training (sample) transactions are never included."
        actions={
          <>
            {can(actor, "sales.create") && (
              <LinkButton href="/pos" variant="gold" icon={<Plus className="h-4 w-4" />}>
                New sale
              </LinkButton>
            )}
            {canReports && (
              <LinkButton href="/dashboard/reports" variant="outline">
                Reports
              </LinkButton>
            )}
          </>
        }
      />

      {(tax.registrationType === null || (!payments.upiEnabled && payments.gatewayProvider === "none")) && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {tax.registrationType === null && (
            <Alert tone="warning" title="GST registration not confirmed">
              Real bills are blocked until GST registration is confirmed in Settings → Tax. Only training (sample) sales can be completed.
              {actor.isSuperAdmin && (
                <>
                  {" "}
                  <Link href="/dashboard/settings" className="font-semibold underline">
                    Configure now
                  </Link>
                </>
              )}
            </Alert>
          )}
          {!payments.upiEnabled && payments.gatewayProvider === "none" && (
            <Alert tone="info" title="UPI QR is not set up">
              Payment QR codes need the shop&apos;s UPI ID in Settings → Payments. Cash and other configured methods still work.
            </Alert>
          )}
        </div>
      )}

      {canReports && today && month ? (
        <>
          <section aria-labelledby="today-h">
            <h2 id="today-h" className="label-sm mb-2.5 text-navy-500">
              Today
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <Stat label="Net sales (excl. GST)" value={formatINR(today.netRevenue)} hint={`${today.bills.count} bill${today.bills.count === 1 ? "" : "s"} · GST ${formatINR(today.netTax)}`} />
              <Stat
                label="Collections (cash flow)"
                value={formatINR(today.collections.net)}
                hint={`Received ${formatINR(today.collections.received)}${D(today.collections.refunded).greaterThan(0) ? ` · refunded ${formatINR(today.collections.refunded)}` : ""}`}
                tone="green"
              />
              <Stat
                label="Pending payments"
                value={formatINR(today.pendingPayments.amount)}
                hint={`${today.pendingPayments.count} sale${today.pendingPayments.count === 1 ? "" : "s"} awaiting payment (all dates)`}
                tone={today.pendingPayments.count ? "gold" : "navy"}
              />
              <Stat label="Discounts given" value={formatINR(today.bills.discounts)} hint={`${today.discountPercentOfGross}% of gross sales`} />
            </div>
          </section>

          <section aria-labelledby="month-h">
            <h2 id="month-h" className="label-sm mb-2.5 text-navy-500">
              This month
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
              <Stat label="Net sales (excl. GST)" value={formatINR(month.netRevenue)} hint={`Invoiced ${formatINR(month.netInvoiced)} incl. GST`} />
              <Stat label="Bills issued" value={month.bills.count.toLocaleString("en-IN")} hint={`Average bill ${formatINR(month.averageBill)}${month.creditNotes.count ? ` · ${plural(month.creditNotes.count, "credit note")}` : ""}`} />
              <Stat label="GST collected" value={formatINR(month.netTax)} hint="Output tax on bills, less credit notes" />
              {canProfit && month.profit ? (
                month.profit.grossMarginPercent === null ? (
                  // Nothing sold this month has a recorded cost: there is no profit figure to show, not a zero.
                  <Stat label="Gross profit — not net profit" value={<span className="text-navy-400">—</span>} hint="No sales with a recorded cost yet" />
                ) : (
                  <Stat
                    label="Gross profit — not net profit"
                    value={formatINR(month.profit.grossProfit)}
                    tone="green"
                    hint={`Margin ${month.profit.grossMarginPercent}%${
                      Number(month.profit.costCoveragePercent) < 100 ? ` · based on ${month.profit.costCoveragePercent}% of sales with known cost` : ""
                    }`}
                  />
                )
              ) : (
                <Stat label="Collections (cash flow)" value={formatINR(month.collections.net)} tone="green" hint="Money received less refunds" />
              )}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Net sales — last 30 days" description={`Excluding GST · total ${formatINR(thirtyDayTotal.toFixed(2))}`} />
              <CardBody>
                {thirtyDayTotal.isZero() ? (
                  <EmptyState title="No sales recorded yet" description="Bars appear here as real bills are issued." />
                ) : (
                  <SalesChart points={points} caption="Daily net sales for the last 30 days" />
                )}
              </CardBody>
            </Card>
            <ActionItems pendingDiscounts={pendingDiscounts} pendingPrices={pendingPrices} newOrders={newOrders} pendingPayments={today.pendingPayments} showOrders={can(actor, "orders.view")} showApprovals={can(actor, "discounts.approve") || can(actor, "prices.approve")} />
          </div>
        </>
      ) : (
        <ActionItems pendingDiscounts={pendingDiscounts} pendingPrices={pendingPrices} newOrders={newOrders} pendingPayments={null} showOrders={can(actor, "orders.view")} showApprovals={can(actor, "discounts.approve") || can(actor, "prices.approve")} />
      )}

      {can(actor, "customers.view") && <OnlineCustomersCard actor={actor} />}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {canReports && (
          <Card>
            <CardHeader title="Best sellers this month" description="By net sales (excl. GST), after returns" />
            {best.length ? (
              <TableWrap className="rounded-none border-0 shadow-none">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>Product</th>
                      <th className={thNum}>Qty</th>
                      <th className={thNum}>Net sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {best.map((b) => (
                      <tr key={b.variantId} className={rowHover}>
                        <td className={tdText}>
                          <div className="font-medium">{b.product}</div>
                          <div className="mt-0.5 text-xs text-navy-500">
                            <span className="tabular">{b.sku}</span> · {b.category}
                          </div>
                        </td>
                        <td className={tdNum}>
                          <Qty value={b.quantity} unit={b.unit} />
                        </td>
                        <td className={`${tdNum} font-semibold`}>
                          <Money value={b.revenue} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            ) : (
              <CardBody>
                <EmptyState title="No sales recorded yet" description="Best sellers appear once bills are issued this month." />
              </CardBody>
            )}
          </Card>
        )}
        {recent && (
          <Card>
            <CardHeader
              title="Recent sales"
              actions={
                <Link href="/dashboard/sales" className="group inline-flex items-center gap-1 text-[13px] font-semibold text-navy-700 hover:text-navy-950">
                  All sales <ArrowRight className="h-3.5 w-3.5 transition-transform duration-150 group-hover:translate-x-0.5" />
                </Link>
              }
            />
            {recent.items.length ? (
              <ul className="divide-y divide-navy-100">
                {recent.items.map((s) => (
                  <li key={s.id}>
                    <Link href={`/dashboard/sales/${s.id}`} className={`flex items-center justify-between gap-3 px-5 py-3 ${rowHover}`}>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 tabular text-[13px] font-medium">
                          {s.saleNumber}
                          {s.isTraining && <TrainingBadge />}
                        </div>
                        <div className="truncate text-xs text-navy-500">
                          {s.customerName ?? CASH_SALE} · <DateTime value={s.createdAt} /> · {s.createdByName}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Money value={s.grandTotal} className="tabular text-[13px] font-semibold" />
                        <StatusBadge status={s.status === "completed" ? s.paymentStatus : s.status} />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody>
                <EmptyState title="No sales recorded yet" description={hiddenTraining > 0 ? `${plural(hiddenTraining, "training sale")} ${hiddenTraining === 1 ? "is" : "are"} hidden — open Sales and tick “Include training” to see ${hiddenTraining === 1 ? "it" : "them"}.` : "Start one from the Point of Sale."} />
              </CardBody>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function ActionItems({
  pendingDiscounts,
  pendingPrices,
  newOrders,
  pendingPayments,
  showOrders,
  showApprovals,
}: {
  pendingDiscounts: number;
  pendingPrices: number;
  newOrders: number;
  pendingPayments: { count: number; amount: string } | null;
  showOrders: boolean;
  showApprovals: boolean;
}) {
  const items = [
    showApprovals && {
      href: "/dashboard/approvals",
      icon: BadgeCheck,
      label: "Approvals waiting",
      value: pendingDiscounts + pendingPrices,
      hint: `${plural(pendingDiscounts, "discount")} · ${plural(pendingPrices, "price change")}`,
    },
    showOrders && { href: "/dashboard/orders", icon: Globe, label: "New website orders", value: newOrders, hint: "Enquiries & order requests to answer" },
    pendingPayments && {
      href: "/dashboard/payments?view=pending",
      icon: Wallet,
      label: "Sales awaiting payment",
      value: pendingPayments.count,
      hint: `${formatINR(pendingPayments.amount)} outstanding`,
    },
    { href: "/dashboard/documents", icon: ReceiptText, label: "Bills & documents", value: null, hint: "Reprint, download or share" },
  ].filter(Boolean) as { href: string; icon: typeof Globe; label: string; value: number | null; hint: string }[];
  return (
    <Card>
      <CardHeader title="Needs attention" />
      <ul className="divide-y divide-navy-100">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className={`group flex items-center gap-3.5 px-5 py-3.5 ${rowHover}`}>
              <i.icon className="h-4 w-4 shrink-0 text-navy-400 transition-colors duration-150 group-hover:text-navy-700" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-navy-900">{i.label}</span>
                <span className="mt-0.5 block truncate text-xs text-navy-500">{i.hint}</span>
              </span>
              {i.value !== null && (
                <span
                  className={`min-w-7 rounded-[3px] px-1.5 py-0.5 text-center tabular text-[13px] font-semibold tabular ${i.value ? "bg-gold-100 text-gold-700" : "text-navy-400"}`}
                >
                  {i.value.toLocaleString("en-IN")}
                </span>
              )}
              <ArrowRight className="h-4 w-4 shrink-0 text-navy-300 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-navy-600" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
