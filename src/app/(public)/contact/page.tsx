import type { Metadata } from "next";
import { Suspense } from "react";
import { ArrowUpRight, Clock, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import { Skeleton } from "@/components/ui/page";
import { formatPhone, whatsappLink } from "@/lib/india";
import { EnquiryForm } from "@/components/public/enquiry-form";
import { Container, PageIntro } from "@/components/public/section";
import { addressLines, directionsHref, getSiteData, mapsHref, telHref } from "@/components/public/site-data";
import { ShopMap } from "@/components/public/shop-map";

export const metadata: Metadata = {
  title: "Contact us",
  description: "Call, WhatsApp, email or visit OM ENTERPRISE, Nr. Shivani Showroom, Bodeli Road, Naswadi, Gujarat 391150.",
};

export default function ContactPage() {
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { label: "Contact" }]}
        title="Contact us"
        description="Visit the shop, call, or send us a message and we'll reply by phone or WhatsApp."
      />
      <Container className="py-10 sm:py-14">
        <Suspense
          fallback={
            <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr]">
              <Skeleton className="h-96 rounded-xl" />
              <Skeleton className="h-[30rem] rounded-xl" />
            </div>
          }
        >
          <ContactContent />
        </Suspense>
      </Container>
    </>
  );
}

async function ContactContent() {
  const { business, website } = await getSiteData();
  const wa = business.whatsapp ? whatsappLink(business.whatsapp, "Hello OM ENTERPRISE, I have an enquiry.") : null;
  const lines = [
    business.whatsapp && wa ? { icon: MessageCircle, title: "WhatsApp", value: formatPhone(business.whatsapp), href: wa, external: true, mono: true } : null,
    business.phone ? { icon: Phone, title: "Call", value: formatPhone(business.phone), href: telHref(business.phone), external: false, mono: true } : null,
    business.email ? { icon: Mail, title: "Email", value: business.email, href: `mailto:${business.email}`, external: false, mono: false } : null,
  ].filter((c): c is NonNullable<typeof c> => !!c);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.3fr] lg:gap-12">
      <div>
        <ul className="border-t border-navy-200">
          {lines.map((c) => (
            <li key={c.title}>
              <a
                href={c.href}
                target={c.external ? "_blank" : undefined}
                rel={c.external ? "noopener noreferrer" : undefined}
                className="group flex items-center gap-4 border-b border-navy-100 py-4"
              >
                <c.icon className="h-[18px] w-[18px] shrink-0 text-gold-600" />
                <span className="label-sm w-20 shrink-0 text-navy-500">{c.title}</span>
                <span className={`min-w-0 flex-1 truncate text-[17px] text-navy-950 ${c.mono ? "tabular" : "font-medium"}`}>{c.value}</span>
                <ArrowUpRight className="h-4 w-4 shrink-0 text-navy-300 transition-[transform,color] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-navy-900" />
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-8 rounded-xl border border-navy-200 bg-paper/60 p-5">
          <div className="label-sm flex items-center gap-2 text-navy-500">
            <MapPin className="h-3.5 w-3.5 text-gold-600" /> Shop address
          </div>
          <address className="mt-2 text-[15px] not-italic leading-relaxed text-navy-800">
            <span className="block font-semibold text-navy-950">{business.name}</span>
            {addressLines(business).map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </address>
          {business.openingHours && (
            <div className="mt-4 flex gap-3 border-t border-rule pt-4">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" />
              <div>
                <div className="label-sm text-navy-500">Opening hours</div>
                <div className="mt-1 text-sm text-navy-800">{business.openingHours}</div>
              </div>
            </div>
          )}
        </div>
        <ShopMap name={business.name} embedUrl={business.mapEmbedUrl} opensHref={mapsHref(business)} directionsHref={directionsHref(business)} className="mt-6" />
      </div>
      <section aria-labelledby="contact-form" className="rounded-xl border border-navy-200 bg-white p-5 sm:p-7">
        <h2 id="contact-form" className="text-lg font-semibold tracking-[-0.01em] text-navy-950">Send a message</h2>
        <p className="mt-1 text-sm text-navy-500">Tell us what you need — sizes, quantities, brands — and how to reach you.</p>
        <div className="mt-6">
          {website.enquiriesEnabled ? (
            <EnquiryForm items={[]} whatsapp={business.whatsapp || null} allowOrderRequest={false} />
          ) : (
            <p className="rounded-lg bg-navy-50 p-4 text-sm text-navy-700">Online messages are paused right now. Please call or WhatsApp us.</p>
          )}
        </div>
      </section>
    </div>
  );
}
