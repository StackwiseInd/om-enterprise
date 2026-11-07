import { Suspense } from "react";
import Link from "next/link";
import { BadgeCheck, MailWarning } from "lucide-react";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/auth/actor";
import { CUSTOMER_FILTERS, listShopCustomers, shopCustomerStats, type CustomerFilter } from "@/server/services/shop-customers";
import { formatINR } from "@/lib/money";
import { formatPhone } from "@/lib/india";
import { Stat } from "@/components/ui/card";
import { EmptyState, PageHeader, PageSkeleton, TableWrap } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { DateTime, Money } from "@/components/ui/money";
import { FilterBar } from "@/components/dashboard/ops/filter-bar";
import { Pagination } from "@/components/dashboard/ops/pagination";
import { CsvExportButton } from "@/components/dashboard/ops/csv-export";
import { num, str, type SearchParams } from "@/components/dashboard/ops/params";
import { nameLink, rowHover, tdCode, tdMuted, tdNum, tdText, th, thNum } from "@/components/dashboard/table";

export const metadata = { title: "Online customers" };

export default function WebsiteCustomersPage({ searchParams }: PageProps<"/dashboard/website-customers">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <WebsiteCustomers searchParams={searchParams} />
    </Suspense>
  );
}

async function WebsiteCustomers({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requirePageActor("customers.view");
  const sp = await searchParams;
  const page = num(sp, "page", 1);
  const pageSize = 50;
  const raw = str(sp, "filter");
  const filter = (CUSTOMER_FILTERS as string[]).includes(raw ?? "") ? (raw as CustomerFilter) : "all";
  const q = str(sp, "q");
  const [data, stats] = await Promise.all([listShopCustomers(actor, { q, filter, page, pageSize }), shopCustomerStats(actor)]);

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Online customers"
        description="People who created an account on the website. Passwords are stored scrambled and can't be seen by anyone; if a customer forgets theirs, open their record and set a new one."
        actions={
          can(actor, "reports.export") ? (
            <CsvExportButton
              rows={data.items.map((c) => ({
                name: c.name,
                mobile: c.mobile,
                email: c.email ?? "",
                email_verified: c.emailVerifiedAt ? "yes" : "no",
                orders: c.orders,
                paid_orders: c.paidOrders,
                spent: c.spent,
                joined: c.createdAt.toISOString(),
                last_sign_in: c.lastLoginAt?.toISOString() ?? "",
                status: c.isActive ? "active" : "disabled",
              }))}
              filename={`om-online-customers-page-${page}.csv`}
              label="Export page (CSV)"
            />
          ) : null
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Stat label="Online customers" value={stats.total.toLocaleString("en-IN")} hint={`${stats.newThisWeek} joined in the last 7 days`} />
        <Stat label="Email verified" value={stats.verified.toLocaleString("en-IN")} tone="green" hint={stats.total ? `${Math.round((stats.verified / stats.total) * 100)}% of customers` : "—"} />
        <Stat label="Have paid" value={stats.buyers.toLocaleString("en-IN")} hint="At least one paid order" />
        <Stat label="Spent online" value={formatINR(stats.spent)} tone="gold" hint="Paid orders, incl. GST" />
        <Stat label="Disabled" value={stats.disabled.toLocaleString("en-IN")} tone={stats.disabled ? "red" : "navy"} hint="Can't sign in" />
      </div>
      <FilterBar
        fields={[
          { kind: "search", name: "q", placeholder: "Name, mobile or email" },
          {
            kind: "select",
            name: "filter",
            label: "Show",
            options: [
              { value: "", label: "All customers" },
              { value: "buyers", label: "Have paid" },
              { value: "verified", label: "Email verified" },
              { value: "unverified", label: "Email not verified" },
              { value: "disabled", label: "Disabled" },
            ],
          },
        ]}
        values={{ q, filter: filter === "all" ? undefined : filter }}
      />
      {data.items.length === 0 ? (
        <EmptyState title={q || filter !== "all" ? "No matching customers" : "No online customers yet"} description="Customers appear here when they create an account on the website." />
      ) : (
        <TableWrap>
          <table className="stack-sm w-full min-w-[980px]">
            <thead>
              <tr>
                <th className={th}>Customer</th>
                <th className={th}>Mobile</th>
                <th className={th}>Email</th>
                <th className={thNum}>Orders</th>
                <th className={thNum}>Spent</th>
                <th className={th}>Last order</th>
                <th className={th}>Joined</th>
                <th className={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((c) => (
                <tr key={c.id} className={rowHover}>
                  <td data-label="Customer" className={tdText}>
                    <Link href={`/dashboard/website-customers/${c.id}`} className={nameLink}>
                      {c.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-navy-500">{c.lastLoginAt ? <>Last sign-in <DateTime value={c.lastLoginAt} dateOnly /></> : "Never signed in again"}</div>
                  </td>
                  <td data-label="Mobile" className={tdCode}>
                    <a href={`tel:+91${c.mobile}`} className="underline-offset-[3px] hover:underline">
                      {formatPhone(c.mobile)}
                    </a>
                  </td>
                  <td data-label="Email" className={tdText}>
                    {c.email ? (
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <a href={`mailto:${c.email}`} className="max-w-[220px] truncate text-[13px] underline-offset-[3px] hover:underline" title={c.email}>
                          {c.email}
                        </a>
                        {c.emailVerifiedAt ? (
                          <Badge tone="green"><BadgeCheck className="h-3 w-3" /> Verified</Badge>
                        ) : (
                          <Badge tone="amber"><MailWarning className="h-3 w-3" /> Not verified</Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-navy-300">—</span>
                    )}
                  </td>
                  <td data-label="Orders" className={tdNum}>
                    {c.orders}
                    {c.paidOrders > 0 && <div className="text-[11px] font-normal text-navy-500">{c.paidOrders} paid</div>}
                  </td>
                  <td data-label="Spent" className={`${tdNum} font-semibold`}>
                    <Money value={c.spent} muted={Number(c.spent) === 0} />
                  </td>
                  <td data-label="Last order" className={tdMuted}>{c.lastOrderAt ? <DateTime value={c.lastOrderAt} dateOnly /> : <span className="text-navy-300">—</span>}</td>
                  <td data-label="Joined" className={tdMuted}><DateTime value={c.createdAt} dateOnly /></td>
                  <td data-label="Status" className={tdText}>
                    <Badge tone={c.isActive ? "green" : "red"}>{c.isActive ? "Active" : "Disabled"}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pagination total={data.total} page={page} pageSize={pageSize} sp={sp} basePath="/dashboard/website-customers" />
    </div>
  );
}
