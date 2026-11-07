import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight } from "lucide-react";
import { Skeleton } from "@/components/ui/page";
import { LinkButton } from "@/components/ui/button";
import { Container, PageIntro, SectionHeading } from "@/components/public/section";
import { addressLines, directionsHref, getSiteData, mapsHref } from "@/components/public/site-data";
import { ShopMap } from "@/components/public/shop-map";

export const metadata: Metadata = {
  title: "About us",
  description: "OM ENTERPRISE — building materials for homes, shops and construction projects in and around Naswadi, Gujarat.",
};

const PRACTICES = [
  { title: "Branded products", text: "Pipes, fittings, tanks, paints and bath fittings from the manufacturers listed in our catalogue." },
  { title: "One price list", text: "The counter and this website read the same price list. We confirm the price when we bill you." },
  { title: "A bill for every sale", text: "Every purchase is billed, with a printed copy or a link you can open on your phone." },
  { title: "Help choosing", text: "Tell us the job and we'll help you pick the right size, pressure class and quantity." },
];

export default function AboutPage() {
  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { label: "About us" }]} eyebrow="About us" title="Your complete building solution">
        <Suspense fallback={<div className="mt-4 h-24 max-w-2xl animate-pulse rounded-md bg-navy-100" />}>
          <AboutIntro />
        </Suspense>
      </PageIntro>

      <section className="py-14 sm:py-20">
        <Container>
          <SectionHeading eyebrow="How we work" title="At the counter" />
          <dl className="max-w-3xl border-t border-navy-200">
            {PRACTICES.map((p) => (
              <div key={p.title} className="grid gap-1 border-b border-navy-100 py-4 sm:grid-cols-[13rem_1fr] sm:gap-6">
                <dt className="text-[15px] font-semibold text-navy-950">{p.title}</dt>
                <dd className="text-sm leading-relaxed text-navy-600">{p.text}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </section>

      <section className="border-t border-rule py-14 sm:py-20" aria-labelledby="find-us">
        <Container>
          <SectionHeading eyebrow="Visit us" title={<span id="find-us">Find the shop</span>} description="Come and collect your order, or see the range in person." />
          <Suspense fallback={<Skeleton className="h-80 rounded-xl" />}>
            <FindUs />
          </Suspense>
        </Container>
      </section>

      <section className="border-t border-rule bg-paper py-14 sm:py-20">
        <Container>
          <SectionHeading eyebrow="What we stock" title="Product range" />
          <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
            <RangeList />
          </Suspense>
        </Container>
      </section>
    </>
  );
}

async function AboutIntro() {
  const { business } = await getSiteData();
  return (
    <>
      <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-navy-600">{business.about}</p>
      <p className="mt-3 tabular text-[12.5px] text-navy-500">{addressLines(business).join(", ")}</p>
      <div className="mt-7 flex flex-wrap gap-2.5">
        <LinkButton href="/products" size="lg" icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse">
          Browse products
        </LinkButton>
        <LinkButton href="/contact" variant="outline" size="lg">
          Contact us
        </LinkButton>
      </div>
    </>
  );
}

async function FindUs() {
  const { business } = await getSiteData();
  return (
    <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
      <div>
        <address className="text-[17px] not-italic leading-snug text-navy-950">
          <span className="block font-semibold">{business.name}</span>
          {addressLines(business).map((l) => (
            <span key={l} className="block">
              {l}
            </span>
          ))}
        </address>
        {business.openingHours && <p className="mt-3 text-sm text-navy-600">Open: {business.openingHours}</p>}
      </div>
      <ShopMap name={business.name} embedUrl={business.mapEmbedUrl} opensHref={mapsHref(business)} directionsHref={directionsHref(business)} />
    </div>
  );
}

async function RangeList() {
  const { categories } = await getSiteData();
  const top = categories.filter((c) => !c.parentId);
  return (
    <ul className="grid gap-x-10 sm:grid-cols-2">
      {top.map((c) => (
        <li key={c.slug}>
          <Link href={`/category/${c.slug}`} className="group flex items-baseline justify-between gap-4 border-b border-rule py-3.5">
            <span className="font-medium text-navy-950 transition-colors group-hover:text-gold-700">{c.name}</span>
            <span className="shrink-0 tabular text-[12px] text-navy-500">{c.productCount} items</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
