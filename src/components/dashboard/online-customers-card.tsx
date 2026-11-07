import Link from "next/link";
import { ArrowRight, BadgeCheck, MailWarning, UsersRound } from "lucide-react";
import type { Actor } from "@/server/auth/actor";
import { latestShopCustomers, shopCustomerStats } from "@/server/services/shop-customers";
import { formatPhone } from "@/lib/india";
import { formatINR } from "@/lib/money";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DateTime } from "@/components/ui/money";
import { nameLink } from "@/components/dashboard/table";

/** Dashboard overview: who is signing up on the website, how many have paid, and the newest sign-ups. */
export async function OnlineCustomersCard({ actor }: { actor: Actor }) {
  const [stats, latest] = await Promise.all([shopCustomerStats(actor), latestShopCustomers(actor, 5)]);
  return (
    <section aria-labelledby="online-customers-h">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 id="online-customers-h" className="label-sm text-navy-500">
          Online customers
        </h2>
        <Link href="/dashboard/website-customers" className="group inline-flex items-center gap-1 text-[13px] font-semibold text-navy-900">
          <span className="link-draw">View all</span> <ArrowRight className="h-3.5 w-3.5 text-gold-600 transition-transform group-hover:translate-x-0.5" />
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Stat label="Website accounts" value={stats.total.toLocaleString("en-IN")} hint={`${stats.newThisWeek} joined in the last 7 days`} />
        <Stat label="Email verified" value={stats.verified.toLocaleString("en-IN")} tone="green" hint={stats.total ? `${Math.round((stats.verified / stats.total) * 100)}% of accounts` : "—"} />
        <Stat label="Have paid" value={stats.buyers.toLocaleString("en-IN")} hint="At least one paid order" />
        <Stat label="Spent online" value={formatINR(stats.spent)} tone="gold" hint="Paid orders, incl. GST" />
      </div>
      <Card className="mt-3 sm:mt-4">
        <CardHeader title="Latest sign-ups" description="Newest accounts first." />
        <CardBody className="p-0">
          {latest.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-6 text-sm text-navy-500">
              <UsersRound className="h-5 w-5 text-navy-300" /> Nobody has created a website account yet.
            </div>
          ) : (
            <ul className="divide-y divide-navy-100">
              {latest.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
                  <div className="min-w-0">
                    <Link href={`/dashboard/website-customers/${c.id}`} className={nameLink}>
                      {c.name}
                    </Link>
                    <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-navy-500">
                      <span className="tabular">{formatPhone(c.mobile)}</span>
                      {c.email && <span className="max-w-[240px] truncate">{c.email}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.emailVerifiedAt ? <Badge tone="green"><BadgeCheck className="h-3 w-3" /> Verified</Badge> : <Badge tone="amber"><MailWarning className="h-3 w-3" /> Not verified</Badge>}
                    <span className="whitespace-nowrap text-xs text-navy-500">
                      <DateTime value={c.createdAt} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </section>
  );
}
