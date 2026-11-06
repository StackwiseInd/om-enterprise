import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/page";
import { Container, PageIntro } from "@/components/public/section";
import { ShopSignOut } from "@/components/public/shop-sign-out";
import { getShopAccount } from "@/server/auth/shop-session";
import { listMyOrders } from "@/server/services/online-orders";
import { formatPhone } from "@/lib/india";
import { formatPrice } from "@/lib/money";
import { ONLINE_ORDER_STATUS } from "@/lib/online-order-status";

export const metadata: Metadata = { title: "My orders", robots: { index: false } };

export default function MyOrdersPage() {
  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { label: "My orders" }]} title="My orders" />
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <Content />
        </Suspense>
      </Container>
    </>
  );
}

async function Content() {
  const account = await getShopAccount();
  if (!account) redirect("/sign-in?next=/my-orders");
  const orders = await listMyOrders(account);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm text-navy-600">
        <span>
          Signed in as <span className="font-semibold text-navy-950">{account.name}</span> · <span className="tabular">{formatPhone(account.mobile)}</span>
        </span>
        <ShopSignOut />
      </div>
      {orders.length === 0 ? (
        <div className="blueprint rounded-xl border border-navy-200 p-10 text-center">
          <p className="font-semibold text-navy-950">No orders yet</p>
          <p className="mt-1 text-sm text-navy-500">Add products to your cart and check out to pay by UPI.</p>
          <Link href="/products" className="mt-4 inline-flex h-10 items-center rounded-lg bg-navy-900 px-4 text-sm font-semibold text-white hover:bg-navy-800">Browse products</Link>
        </div>
      ) : (
        <ul className="divide-y divide-navy-100 overflow-hidden rounded-xl border border-navy-200 bg-white">
          {orders.map((o) => (
            <li key={o.orderNumber}>
              <Link href={`/my-orders/${o.orderNumber}`} className="group flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-paper/60">
                <div className="min-w-0">
                  <div className="tabular font-semibold text-navy-950">{o.orderNumber}</div>
                  <div className="text-[13px] text-navy-500">{new Date(o.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</div>
                </div>
                <div className="flex items-center gap-4">
                  <Badge tone={ONLINE_ORDER_STATUS[o.status].tone}>{ONLINE_ORDER_STATUS[o.status].customer}</Badge>
                  <span className="tabular font-semibold text-navy-950">{formatPrice(o.total)}</span>
                  <ArrowRight className="h-4 w-4 text-navy-300 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
