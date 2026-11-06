import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/page";
import { EnquiryList } from "@/components/public/enquiry-list";
import { Container, PageIntro } from "@/components/public/section";
import { getSiteData } from "@/components/public/site-data";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = {
  title: "Cart",
  description: "Send your list of building materials to OM ENTERPRISE for a quote or order confirmation.",
  robots: { index: false },
};

export default function EnquiryPage() {
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { label: "Cart" }]}
        title="Your cart"
        description="Pay online by UPI and collect from the store, or send the list to us and we'll confirm stock and the final amount on WhatsApp."
      />
      <Container className="py-8 sm:py-10">
        <Suspense
          fallback={
            <div className="grid gap-8 lg:grid-cols-[1.25fr_1fr]">
              <Skeleton className="h-80 rounded-xl" />
              <Skeleton className="h-[28rem] rounded-xl" />
            </div>
          }
        >
          <EnquiryContent />
        </Suspense>
      </Container>
    </>
  );
}

async function EnquiryContent() {
  const { business, website } = await getSiteData();
  const payments = await getSettings("payments").catch(() => null);
  const onlinePay = !!(payments?.upiEnabled && payments.upiVpa);
  return <EnquiryList whatsapp={business.whatsapp || null} priceNote={website.priceNote} enquiriesEnabled={website.enquiriesEnabled} onlinePay={onlinePay} />;
}
