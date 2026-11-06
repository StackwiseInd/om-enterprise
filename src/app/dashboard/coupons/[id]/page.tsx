import { Suspense } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { requirePageActor } from "@/server/auth/session";
import { getCouponBatch } from "@/server/services/coupons";
import { PageHeader, PageSkeleton, TableWrap } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { DateTime, Money } from "@/components/ui/money";
import { DisableCouponsButton } from "@/components/dashboard/ops/coupon-actions";
import { loadOr404 } from "@/components/dashboard/ops/guard";
import { BackLink } from "@/components/dashboard/back-link";
import { codeLink, rowHover, tdText, th } from "@/components/dashboard/table";
import { formatPrice } from "@/lib/money";

export const metadata = { title: "Discount codes" };

const TONE = { active: "green", reserved: "amber", used: "neutral", disabled: "red" } as const;
const LABEL = { active: "Unused", reserved: "On an order (awaiting payment)", used: "Used", disabled: "Disabled" } as const;

export default function BatchPage({ params }: PageProps<"/dashboard/coupons/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Batch params={params} />
    </Suspense>
  );
}

async function Batch({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requirePageActor("discounts.configure");
  const { id } = await params;
  const { batch, codes } = await loadOr404(getCouponBatch(actor, id));
  const unused = codes.filter((c) => c.status === "active").length;
  return (
    <div className="space-y-6">
      <BackLink href="/dashboard/coupons">All discount codes</BackLink>
      <PageHeader
        eyebrow="Discount codes"
        title={batch.label}
        description={
          <>
            {formatPrice(batch.amountOff)} off{Number(batch.minOrder) > 0 ? ` orders of ${formatPrice(batch.minOrder)} or more` : ""}
            {batch.validUntil ? <> · valid until <DateTime value={batch.validUntil} /></> : " · no end date"} · {codes.length} codes, {unused} unused
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/admin/coupons/batches/${batch.id}/csv`} className={buttonClass("outline")}>
              <Download className="h-4 w-4" /> Download CSV
            </a>
            {unused > 0 && <DisableCouponsButton batchId={batch.id} label="Disable unused codes" />}
          </div>
        }
      />
      <TableWrap>
        <table className="stack-sm w-full min-w-[620px]">
          <thead>
            <tr>
              <th className={th}>Code</th>
              <th className={th}>Status</th>
              <th className={th}>Order</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id} className={rowHover}>
                <td data-label="Code" className={`${tdText} tabular text-[15px] font-semibold tracking-wide`}>{c.code}</td>
                <td data-label="Status" className={tdText}>
                  <Badge tone={TONE[c.status]}>{LABEL[c.status]}</Badge>
                  {c.usedAt && <div className="mt-1 text-xs text-navy-500"><DateTime value={c.usedAt} /></div>}
                </td>
                <td data-label="Order" className={tdText}>
                  {c.orderId && c.orderNumber ? <Link href={`/dashboard/online-orders/${c.orderId}`} className={codeLink}>{c.orderNumber}</Link> : <span className="text-navy-300">—</span>}
                </td>
                <td className={`${tdText} text-right`}>{c.status === "active" && <DisableCouponsButton couponId={c.id} label="Disable" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="text-xs text-navy-500">
        Amount off: <Money value={batch.amountOff} />. A code on an order waiting for payment comes back into use if that order is cancelled, expires or its payment isn&apos;t found.
      </p>
    </div>
  );
}
