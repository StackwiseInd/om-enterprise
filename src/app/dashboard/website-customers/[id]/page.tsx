import { Suspense } from "react";
import Link from "next/link";
import { BadgeCheck, Mail, MailWarning, MessageCircle, Phone } from "lucide-react";
import { requirePageActor } from "@/server/auth/session";
import { can } from "@/server/auth/actor";
import { getShopCustomer } from "@/server/services/shop-customers";
import { gatewayName, isGatewayMethod } from "@/lib/gateway";
import { whatsappLink, formatPhone } from "@/lib/india";
import { formatINR } from "@/lib/money";
import { ONLINE_ORDER_STATUS } from "@/lib/online-order-status";
import { profileAddressLines } from "@/lib/shop-profile";
import { Card, CardBody, CardHeader, Stat } from "@/components/ui/card";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DateTime, Money } from "@/components/ui/money";
import { WebsiteCustomerActions } from "@/components/dashboard/ops/website-customer-actions";
import { loadOr404 } from "@/components/dashboard/ops/guard";
import { BackLink } from "@/components/dashboard/back-link";
import { TitleStamps } from "@/components/dashboard/title-stamps";
import { codeLink, rowHover, tdMuted, tdNum, tdText, th, thNum } from "@/components/dashboard/table";

export const metadata = { title: "Online customer" };

export default function WebsiteCustomerPage({ params }: PageProps<"/dashboard/website-customers/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Detail params={params} />
    </Suspense>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-navy-100 py-2.5 text-sm last:border-b-0">
      <dt className="shrink-0 text-navy-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-navy-950">{children}</dd>
    </div>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("customers.view");
  const { id } = await params;
  const { customer: c, orders, stats, history } = await loadOr404(getShopCustomer(actor, id));
  const locked = c.lockedUntil && c.lockedUntil > new Date();

  return (
    <div className="space-y-6">
      <BackLink href="/dashboard/website-customers">All online customers</BackLink>
      <PageHeader
        eyebrow="Online customer · website account"
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            <TitleStamps>
              <Badge tone={c.isActive ? "green" : "red"}>{c.isActive ? "Active" : "Disabled"}</Badge>
              {c.emailVerifiedAt ? <Badge tone="green"><BadgeCheck className="h-3 w-3" /> Email verified</Badge> : <Badge tone="amber"><MailWarning className="h-3 w-3" /> Email not verified</Badge>}
              {locked && <Badge tone="amber">Locked after wrong passwords</Badge>}
            </TitleStamps>
          </span>
        }
        description={`Joined ${c.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" })}`}
        actions={
          <>
            <a href={`tel:+91${c.mobile}`} className={buttonClass("outline")}>
              <Phone className="h-4 w-4" /> Call
            </a>
            <a href={whatsappLink(c.mobile, `Namaste ${c.name}, this is OM ENTERPRISE, Naswadi.`)} target="_blank" rel="noopener noreferrer" className={buttonClass("success")}>
              <MessageCircle className="h-4 w-4" /> WhatsApp
            </a>
            {c.email && (
              <a href={`mailto:${c.email}`} className={buttonClass("outline")}>
                <Mail className="h-4 w-4" /> Email
              </a>
            )}
            {can(actor, "customers.edit") && <WebsiteCustomerActions id={c.id} name={c.name} active={c.isActive} />}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Orders" value={stats.orders.toLocaleString("en-IN")} hint={stats.lastOrderAt ? <>Last <DateTime value={stats.lastOrderAt} dateOnly /></> : "No orders yet"} />
        <Stat label="Paid orders" value={stats.paidOrders.toLocaleString("en-IN")} tone="green" hint={`${stats.collected} collected from the shop`} />
        <Stat label="Spent online" value={formatINR(stats.spent)} tone="gold" hint="Paid orders, incl. GST" />
        <Stat label="Sign-ins" value={c.lastLoginAt ? <DateTime value={c.lastLoginAt} dateOnly /> : "—"} hint={c.lastLoginAt ? "Last signed in" : "Hasn't signed in again"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Account" description="What the customer gave when signing up." />
            <CardBody>
              <dl>
                <Row label="Name">{c.name}</Row>
                <Row label="Mobile"><a href={`tel:+91${c.mobile}`} className={codeLink}>{formatPhone(c.mobile)}</a></Row>
                <Row label="Email">
                  {c.email ? (
                    <>
                      <a href={`mailto:${c.email}`} className="underline-offset-[3px] hover:underline">{c.email}</a>
                      <span className="block text-xs text-navy-500">
                        {c.emailVerifiedAt ? <>Verified <DateTime value={c.emailVerifiedAt} /></> : "Not verified"}
                      </span>
                    </>
                  ) : (
                    <span className="text-navy-300">—</span>
                  )}
                </Row>
                <Row label="Password"><span className="text-navy-500">Stored scrambled; can&apos;t be seen</span></Row>
                <Row label="Joined"><DateTime value={c.createdAt} /></Row>
                <Row label="Last sign-in">{c.lastLoginAt ? <DateTime value={c.lastLoginAt} /> : <span className="text-navy-300">—</span>}</Row>
                {c.failedLoginCount > 0 && <Row label="Wrong passwords in a row">{c.failedLoginCount}</Row>}
                {locked && <Row label="Locked until"><DateTime value={c.lockedUntil!} /></Row>}
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Profile"
              description={c.profileUpdatedAt ? <>What the customer keeps on My profile. Updated <DateTime value={c.profileUpdatedAt} />.</> : "What the customer keeps on My profile. Not filled in yet."}
            />
            <CardBody>
              <dl>
                <Row label="Business">{c.businessName ?? <span className="text-navy-300">—</span>}</Row>
                <Row label="GSTIN">{c.gstin ? <span className="tabular">{c.gstin}</span> : <span className="text-navy-300">—</span>}</Row>
                <Row label="Other phone">{c.altMobile ? <a href={`tel:+91${c.altMobile}`} className={codeLink}>{formatPhone(c.altMobile)}</a> : <span className="text-navy-300">—</span>}</Row>
                <Row label="Address">
                  {profileAddressLines(c).length ? (
                    <span className="block whitespace-pre-line">{profileAddressLines(c).join("\n")}</span>
                  ) : (
                    <span className="text-navy-300">—</span>
                  )}
                </Row>
              </dl>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" description="Sign-up, profile changes, verification and staff actions, from the audit log." />
            <CardBody>
              {history.length === 0 ? (
                <p className="text-sm text-navy-500">Nothing recorded yet.</p>
              ) : (
                <ol className="space-y-3">
                  {history.map((h) => (
                    <li key={h.id} className="text-sm">
                      <div className="text-navy-950">{h.summary}</div>
                      <div className="mt-0.5 text-xs text-navy-500">
                        <DateTime value={h.at} /> · {h.actorLabel}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>

        <Card className="min-w-0 xl:col-span-2 xl:self-start">
          <CardHeader title="Orders" description="Everything this customer ordered on the website." />
          {orders.length === 0 ? (
            <CardBody>
              <EmptyState title="No orders yet" description="Their orders appear here once they check out." />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="stack-sm w-full min-w-[620px]">
                <thead>
                  <tr>
                    <th className={th}>Order</th>
                    <th className={th}>Placed</th>
                    <th className={th}>Status</th>
                    <th className={th}>Paid with</th>
                    <th className={thNum}>Items</th>
                    <th className={thNum}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => {
                    const st = ONLINE_ORDER_STATUS[o.status];
                    return (
                      <tr key={o.id} className={rowHover}>
                        <td data-label="Order" className={tdText}>
                          <Link href={`/dashboard/online-orders/${o.id}`} className={codeLink}>{o.orderNumber}</Link>
                        </td>
                        <td data-label="Placed" className={tdMuted}><DateTime value={o.createdAt} /></td>
                        <td data-label="Status" className={tdText}><Badge tone={st.tone}>{st.staff}</Badge></td>
                        <td data-label="Paid with" className={tdMuted}>{isGatewayMethod(o.paymentMethod) ? gatewayName(o.paymentMethod) : "UPI QR"}</td>
                        <td data-label="Items" className={tdNum}>{o.items}</td>
                        <td data-label="Total" className={`${tdNum} font-semibold`}><Money value={o.total} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
