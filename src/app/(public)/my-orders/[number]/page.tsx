import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/page";
import { Container, PageIntro } from "@/components/public/section";
import { OrderPayment } from "@/components/public/order-payment";
import { addressLines, directionsHref, getSiteData, mapsHref } from "@/components/public/site-data";
import { getShopAccount } from "@/server/auth/shop-session";
import { getMyOrder } from "@/server/services/online-orders";

export const metadata: Metadata = { title: "Your order", robots: { index: false } };

export default function OrderPage({ params, searchParams }: PageProps<"/my-orders/[number]">) {
  return (
    <Suspense
      fallback={
        <Container className="py-10">
          <Skeleton className="h-96 rounded-xl" />
        </Container>
      }
    >
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: PageProps<"/my-orders/[number]">["params"]; searchParams: PageProps<"/my-orders/[number]">["searchParams"] }) {
  const { number } = await params;
  // Straight from checkout (?pay=1): the payment window opens on arrival.
  const autoPay = (await searchParams).pay === "1";
  const account = await getShopAccount();
  if (!account) redirect(`/sign-in?next=/my-orders/${encodeURIComponent(number)}`);
  if (!/^OL\d{6,}$/.test(number)) notFound();
  const data = await getMyOrder(account, number).catch(() => null);
  if (!data) notFound();
  const { business } = await getSiteData();
  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { href: "/my-orders", label: "My orders" }, { label: number }]} title={`Order ${number}`} />
      <Container className="py-8 sm:py-10">
        <OrderPayment initial={data} autoPay={autoPay} shop={{ name: business.name, address: addressLines(business), mapUrl: mapsHref(business), directionsUrl: directionsHref(business), mapEmbedUrl: business.mapEmbedUrl, phone: business.phone || null, whatsapp: business.whatsapp || null }} />
      </Container>
    </>
  );
}
