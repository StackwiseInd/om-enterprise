import { Suspense } from "react";
import Link from "next/link";
import { requirePageActor } from "@/server/auth/session";
import { listCouponBatches } from "@/server/services/coupons";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, PageSkeleton, TableWrap } from "@/components/ui/page";
import { DateTime, Money } from "@/components/ui/money";
import { CouponGenerator } from "@/components/dashboard/ops/coupon-actions";
import { codeLink, rowHover, tdMuted, tdNum, tdText, th, thNum } from "@/components/dashboard/table";

export const metadata = { title: "Discount codes" };

export default function CouponsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Coupons />
    </Suspense>
  );
}

async function Coupons() {
  const actor = await requirePageActor("discounts.configure");
  const batches = await listCouponBatches(actor);
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Discount codes"
        description="Single-use codes worth a flat amount off an online order. Give one code to one customer; it can't be used twice."
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="min-w-0">
          {batches.length === 0 ? (
            <EmptyState title="No codes yet" description="Generate your first batch with the form." />
          ) : (
            <TableWrap>
              <table className="stack-sm w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th className={th}>Batch</th>
                    <th className={thNum}>Off</th>
                    <th className={thNum}>Min. order</th>
                    <th className={th}>Valid until</th>
                    <th className={thNum}>Unused</th>
                    <th className={thNum}>On orders</th>
                    <th className={thNum}>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.batch.id} className={rowHover}>
                      <td data-label="Batch" className={tdText}>
                        <Link href={`/dashboard/coupons/${b.batch.id}`} className={codeLink}>
                          {b.batch.label}
                        </Link>
                        <div className="mt-0.5 text-xs text-navy-500">
                          <DateTime value={b.batch.createdAt} /> · {b.createdByName ?? "—"}
                        </div>
                      </td>
                      <td data-label="Off" className={tdNum}><Money value={b.batch.amountOff} /></td>
                      <td data-label="Min. order" className={tdNum}>{Number(b.batch.minOrder) > 0 ? <Money value={b.batch.minOrder} /> : "—"}</td>
                      <td data-label="Valid until" className={tdMuted}>{b.batch.validUntil ? <DateTime value={b.batch.validUntil} /> : "No end date"}</td>
                      <td data-label="Unused" className={tdNum}>{b.active}</td>
                      <td data-label="On orders" className={tdNum}>{b.reserved}</td>
                      <td data-label="Used" className={tdNum}>{b.used}{b.disabled ? <div className="font-sans text-xs text-navy-500">{b.disabled} disabled</div> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </div>
        <Card className="xl:self-start">
          <CardHeader title="Generate codes" />
          <CardBody>
            <CouponGenerator />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
