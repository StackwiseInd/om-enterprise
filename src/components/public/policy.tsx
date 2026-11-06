import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { formatPhone } from "@/lib/india";
import type { Settings } from "@/lib/settings-schema";
import { Container, PageIntro } from "./section";
import { addressLines, getSiteData } from "./site-data";

/**
 * The shop's policy pages (terms, refunds, privacy, pickup). Each page is a list of numbered
 * sections built from the business settings, so the shop's name, address and contact details are
 * always the current ones.
 */

export type Business = Settings["business"];
export interface PolicySection {
  id: string;
  title: string;
  body: ReactNode;
}

/** Shown on every policy page; change it when a policy's wording changes. */
export const POLICY_UPDATED = "6 November 2026";

export const POLICY_PAGES = [
  { href: "/terms", label: "Terms of use" },
  { href: "/refund-policy", label: "Refunds & cancellation" },
  { href: "/pickup-policy", label: "Pickup & delivery" },
  { href: "/privacy", label: "Privacy policy" },
] as const;

export function PolicyPage({ title, path, intro, sections }: { title: string; path: string; intro: string; sections: (b: Business) => PolicySection[] }) {
  return (
    <>
      <PageIntro crumbs={[{ href: "/", label: "Home" }, { label: title }]} eyebrow="Policies" title={title} description={intro}>
        <p className="mt-3 tabular text-[12.5px] text-navy-500">Last updated {POLICY_UPDATED}</p>
      </PageIntro>
      <Container className="py-10 sm:py-14">
        <Suspense fallback={<div className="h-[32rem] max-w-3xl animate-pulse rounded-xl bg-navy-50" />}>
          <PolicyBody path={path} sections={sections} />
        </Suspense>
      </Container>
    </>
  );
}

async function PolicyBody({ path, sections }: { path: string; sections: (b: Business) => PolicySection[] }) {
  const { business } = await getSiteData();
  const list = sections(business);
  return (
    <div className="grid gap-10 lg:grid-cols-[15rem_1fr] lg:gap-14">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <nav aria-label="On this page" className="hidden lg:block">
          <p className="label-sm text-navy-500">On this page</p>
          <ol className="mt-3 space-y-2 border-l border-navy-100 text-sm">
            {list.map((s, i) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="-ml-px block border-l border-transparent py-0.5 pl-3 text-navy-600 transition-colors hover:border-gold-500 hover:text-navy-950">
                  <span className="tabular text-navy-400">{i + 1}.</span> {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <nav aria-label="Other policies" className="lg:mt-8">
          <p className="label-sm text-navy-500">Policies</p>
          <ul className="mt-3 flex flex-wrap gap-2 lg:flex-col lg:gap-1.5">
            {POLICY_PAGES.map((p) =>
              p.href === path ? (
                <li key={p.href}>
                  <span aria-current="page" className="inline-block rounded-md bg-navy-900 px-2.5 py-1 text-[13px] font-medium text-white lg:bg-transparent lg:px-0 lg:py-0 lg:text-sm lg:font-semibold lg:text-navy-950">
                    {p.label}
                  </span>
                </li>
              ) : (
                <li key={p.href}>
                  <Link href={p.href} className="inline-block rounded-md border border-navy-200 px-2.5 py-1 text-[13px] text-navy-700 transition-colors hover:border-navy-400 lg:border-0 lg:px-0 lg:py-0 lg:text-sm lg:text-navy-600 lg:hover:text-navy-950">
                    {p.label}
                  </Link>
                </li>
              ),
            )}
          </ul>
        </nav>
      </aside>
      <article className="max-w-3xl">
        {list.map((s, i) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-24 border-t border-navy-100 py-7 first:border-t-0 first:pt-0">
            <h2 id={`${s.id}-h`} className="flex items-baseline gap-3 text-lg font-semibold tracking-[-0.01em] text-navy-950">
              <span className="tabular text-sm font-medium text-gold-700">{String(i + 1).padStart(2, "0")}</span>
              {s.title}
            </h2>
            <div className="policy-prose mt-3 space-y-3 text-[15px] leading-relaxed text-navy-700">{s.body}</div>
          </section>
        ))}
        <ShopIdentity business={business} />
      </article>
    </div>
  );
}

/** Who "we" are, with every way to reach the shop. */
export function ShopIdentity({ business }: { business: Business }) {
  return (
    <section aria-label="Contact the shop" className="mt-4 rounded-xl border border-navy-200 bg-paper p-5 sm:p-6">
      <p className="label-sm text-navy-500">Questions about this policy</p>
      <p className="mt-2 font-semibold text-navy-950">{business.name}</p>
      <address className="mt-1 text-sm not-italic leading-relaxed text-navy-600">{addressLines(business).join(", ")}</address>
      <dl className="mt-3 grid gap-x-8 gap-y-1 tabular text-[13px] text-navy-700 sm:grid-cols-2">
        {business.phone && <Item label="Phone">{formatPhone(business.phone)}</Item>}
        {business.whatsapp && <Item label="WhatsApp">{formatPhone(business.whatsapp)}</Item>}
        {business.email && <Item label="Email">{business.email}</Item>}
        {business.openingHours && <Item label="Hours">{business.openingHours}</Item>}
        {business.gstin && <Item label="GSTIN">{business.gstin}</Item>}
      </dl>
    </section>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-navy-500">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** The company that processes online payments for the shop. */
export const PAYMENT_PARTNER = "Razorpay Software Private Limited (“Razorpay”)";

/**
 * Grievance redressal, as the Consumer Protection (E-Commerce) Rules, 2020 and the Digital Personal Data
 * Protection Act, 2023 expect: a named point of contact, an acknowledgement time and a resolution time.
 */
export function grievanceSection(b: Business): PolicySection {
  return {
    id: "grievance",
    title: "Grievance Officer",
    body: (
      <>
        <p>
          If you have a complaint about an order, a payment, a product, this website or how your personal details are handled, please write to our Grievance Officer: the proprietor of {b.name}. To reach them, {contactLine(b)}, giving your name, mobile number, order number (if any) and what went wrong.
        </p>
        <Bullets
          items={[
            "We acknowledge every complaint within 48 hours.",
            "We aim to resolve it within one month of receiving it, and tell you the outcome.",
            "If you are not satisfied, you can approach the consumer commission, call the National Consumer Helpline on 1915, or file a complaint at consumerhelpline.gov.in. For personal data, you can also complain to the Data Protection Board of India once we have had a chance to reply.",
          ]}
        />
      </>
    ),
  };
}

/** "call 98250 12345, WhatsApp … or email …", from whatever the shop has filled in. */
export function contactLine(b: Business) {
  const ways = [b.phone && `call ${formatPhone(b.phone)}`, b.whatsapp && `WhatsApp ${formatPhone(b.whatsapp)}`, b.email && `email ${b.email}`].filter(Boolean) as string[];
  if (!ways.length) return "visit the shop";
  return ways.length === 1 ? ways[0] : `${ways.slice(0, -1).join(", ")} or ${ways[ways.length - 1]}`;
}

export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1.5 pl-5 [list-style:disc] marker:text-gold-600">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export function PLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-navy-950 underline decoration-navy-300 underline-offset-4 hover:decoration-navy-700">
      {children}
    </Link>
  );
}
