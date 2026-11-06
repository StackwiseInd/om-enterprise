import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/page";
import { Container, PageIntro } from "@/components/public/section";
import { CheckoutView } from "@/components/public/checkout-view";
import { getSiteData, addressShort } from "@/components/public/site-data";
import { getShopAccount } from "@/server/auth/shop-session";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default function CheckoutPage() {
  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { href: "/enquiry", label: "Cart" }, { label: "Checkout" }]} title="Checkout" description="Pay the exact amount by UPI, then collect your items from the store." />
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
  const payments = await getSettings("payments");
  return <CheckoutView account={{ name: account.name, mobile: account.mobile }} pickup={addressShort(business)} shopName={business.name} onlinePay={!!(payments.upiEnabled && payments.upiVpa)} />;
}
