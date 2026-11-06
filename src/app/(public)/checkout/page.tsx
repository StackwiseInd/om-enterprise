import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/page";
import { Container, PageIntro } from "@/components/public/section";
import { CheckoutView } from "@/components/public/checkout-view";
import { getSiteData, addressShort } from "@/components/public/site-data";
import { getShopAccount } from "@/server/auth/shop-session";
import { onlinePaymentMode } from "@/server/services/online-orders";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { href: "/enquiry", label: "Cart" }, { label: "Checkout" }]} title="Checkout" description="Pay online, then collect your items from the store." />
      <Container className="py-8 sm:py-10">
        <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
          <Content />
        </Suspense>
      </Container>
    </>
  );
}

async function Content() {
  const account = await getShopAccount();
  if (!account) redirect("/sign-in?next=/checkout");
  const { business } = await getSiteData();
  const mode = await onlinePaymentMode();
  return <CheckoutView account={{ name: account.name, mobile: account.mobile }} pickup={addressShort(business)} shopName={business.name} mode={mode} />;
}
