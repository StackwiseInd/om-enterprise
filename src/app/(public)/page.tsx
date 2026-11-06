import Link from "next/link";
import { Suspense } from "react";
import { ArrowRight, ArrowUpRight, MessageCircle, Phone, Search } from "lucide-react";
import { getPublicBrands, searchPublicProducts } from "@/server/services/public-catalog";
import { formatPhone, whatsappLink } from "@/lib/india";
import { businessJsonLd, jsonLdHtml } from "@/lib/site-meta";
import { LinkButton } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/page";
import { ProductGrid, ProductGridSkeleton } from "@/components/public/product-card";
import { Container, Eyebrow, SectionHeading } from "@/components/public/section";
import { TechnicalDrawing, type DrawingKind } from "@/components/public/technical-drawing";
import { addressLines, getSiteData, mapsHref, telHref } from "@/components/public/site-data";

export default function HomePage() {
  return (
    <>
      <Suspense fallback={null}>
        <BusinessJsonLd />
      </Suspense>
      <Hero />
      <CategoriesSection />
      <FeaturedSection />
      <OrderingSection />
      <ShopSection />
    </>
  );
}

/** The shop's details for search engines (schema.org HardwareStore), from the business settings. */
async function BusinessJsonLd() {
  const { business } = await getSiteData();
  const site = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const data = businessJsonLd(business, { site, map: mapsHref(business) });
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdHtml(data) }} />;
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-rule bg-paper">
      <Container className="relative grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.25fr_0.75fr] lg:items-center lg:gap-16 lg:py-20">
        <div>
          <Suspense fallback={<HeroCopySkeleton />}>
            <HeroCopy />
          </Suspense>
          <form action="/products" method="get" role="search" className="mt-9 flex max-w-xl gap-2 rounded-xl border border-navy-200 bg-white p-1.5 shadow-card transition-shadow focus-within:shadow-lift">
            <label htmlFor="hero-search" className="sr-only">
              Search products
            </label>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-navy-400" />
              <input
                id="hero-search"
                name="q"
                type="search"
                placeholder="Try “20 mm CPVC elbow”"
                className="h-12 w-full rounded-lg bg-transparent pl-10 pr-3 text-[15px] text-navy-900 placeholder:text-navy-400 focus:outline-none"
              />
            </div>
            <button type="submit" className="h-12 shrink-0 rounded-lg bg-navy-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-800 active:translate-y-px">
              Search
            </button>
          </form>
          <Suspense fallback={<div className="mt-6 h-12" />}>
            <HeroActions />
          </Suspense>
        </div>
        <Suspense fallback={<Skeleton className="h-[420px] rounded-xl" />}>
          <CounterCard />
        </Suspense>
      </Container>
    </section>
  );
}

function HeroCopySkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-3 w-48 animate-pulse rounded-sm bg-navy-100" />
      <div className="h-11 w-4/5 animate-pulse rounded-md bg-navy-100" />
      <div className="h-11 w-3/5 animate-pulse rounded-md bg-navy-100" />
      <div className="h-5 w-full max-w-lg animate-pulse rounded-sm bg-navy-100" />
    </div>
  );
}

async function HeroCopy() {
  const { business, website } = await getSiteData();
  const words = website.heroTitle.trim().split(/\s+/);
  const tail = words.splice(Math.max(1, words.length - 2));
  return (
    <>
      <Eyebrow>
        {business.city}
        {business.district ? ` · ${business.district}` : ""} · Gujarat
      </Eyebrow>
      <h1 className="headline mt-3 animate-rise text-[2.375rem] font-bold text-navy-950 sm:text-[2.875rem] lg:text-[3.25rem]">
        {words.join(" ")} <span className="whitespace-nowrap">{tail.join(" ")}</span>
      </h1>
      <p className="mt-4 max-w-xl animate-[rise_460ms_var(--ease-out-quart)_120ms_both] text-[17px] leading-relaxed text-navy-600">{website.heroSubtitle}</p>
    </>
  );
}

async function HeroActions() {
  const { business } = await getSiteData();
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
      <LinkButton href="/products" size="lg" variant="outline" icon={<ArrowRight className="h-4 w-4" />} className="flex-row-reverse">
        Browse the catalogue
      </LinkButton>
      {business.whatsapp && (
        <a
          href={whatsappLink(business.whatsapp, "Hello OM ENTERPRISE, I need help choosing building materials.")}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-[15px] font-semibold text-navy-900"
        >
          <MessageCircle className="h-[18px] w-[18px] text-emerald-600" /> <span className="link-draw">Ask on WhatsApp</span>
        </a>
      )}
    </div>
  );
}

/** A printed card listing the brands at the counter, with their product counts. */
async function CounterCard() {
  const { categories } = await getSiteData();
  let brands: { name: string; slug: string; productCount: number }[] = [];
  try {
    brands = await getPublicBrands();
  } catch {
    brands = [];
  }
  const top = categories.filter((c) => !c.parentId);
  const total = top.reduce((n, c) => n + c.productCount, 0);
  if (!brands.length) return null;
  return (
    <aside className="relative animate-[rise_520ms_var(--ease-out-quart)_180ms_both] rounded-xl border border-navy-200 bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-navy-100 px-5 py-3.5">
        <span className="label-sm text-navy-500">Brands at the counter</span>
        <span className="text-[13px] text-navy-500">{brands.length} brands</span>
      </div>
      {/* On a phone the names wrap as one short list, so the categories come sooner; from sm up,
          one ruled row per brand with its count. */}
      <ul className="flex flex-wrap gap-x-5 px-5 py-2.5 sm:block sm:divide-y sm:divide-navy-100 sm:py-1">
        {brands.map((b) => (
          <li key={b.slug}>
            <Link href={`/products?brand=${encodeURIComponent(b.slug)}`} className="group flex items-baseline justify-between gap-4 py-1.5 text-[15px] sm:py-2.5">
              <span className="font-semibold text-navy-950 transition-colors group-hover:text-gold-700">{b.name}</span>
              <span className="hidden shrink-0 tabular text-[13px] text-navy-500 sm:inline">
                {b.productCount} <span className="text-navy-400">{b.productCount === 1 ? "item" : "items"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-3 rounded-b-xl border-t border-navy-100 bg-paper/70 px-5 py-3 text-[13px] text-navy-500">
        <span>
          <span className="text-navy-900 tabular">{total}</span> products · <span className="text-navy-900 tabular">{top.length}</span> categories
        </span>
        <Link href="/products" className="link-draw font-medium text-navy-900">
          See all
        </Link>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

const CATEGORY_DRAWING: Record<string, DrawingKind> = {
  paint: "can",
  tank: "tank",
  bath: "tap",
  pipe: "pipe",
  drain: "socket-pipe",
  wrench: "tin",
  brick: "box",
};

function CategoriesSection() {
  return (
    <section className="bg-white pb-14 pt-16 sm:pb-20 sm:pt-24">
      <Container>
        <SectionHeading
          title="Shop by category"
          description="From the first length of pipe to the last coat of paint. Choose a category to see every size we list."
          action={
            <Link href="/products" className="group inline-flex items-center gap-1.5 text-sm font-semibold text-navy-950">
              <span className="link-draw">All products</span> <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          }
        />
        <Suspense
          fallback={
            <div className="grid gap-px sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-64 rounded-none" />
              ))}
            </div>
          }
        >
          <CategoryGrid />
        </Suspense>
      </Container>
    </section>
  );
}

async function CategoryGrid() {
  const { categories } = await getSiteData();
  const top = categories.filter((c) => !c.parentId);
  if (!top.length) return <p className="text-sm text-navy-500">Categories will appear here soon.</p>;
  return (
    <div className="stagger grid grid-cols-2 overflow-hidden rounded-xl border-l border-t border-navy-100 lg:grid-cols-4">
      {top.map((c, i) => (
        <Link
          key={c.slug}
          href={`/category/${c.slug}`}
          style={{ ["--i" as string]: i }}
          className="group relative flex flex-col border-b border-r border-navy-100 bg-white transition-colors duration-200 hover:bg-paper/50"
        >
          <div className="blueprint flex aspect-[5/3] items-center justify-center overflow-hidden border-b border-navy-100">
            <TechnicalDrawing kind={CATEGORY_DRAWING[c.icon ?? ""] ?? "box"} className="h-[78%] w-[78%] transition-transform duration-500 ease-out group-hover:scale-[1.05]" />
          </div>
          <div className="flex-1 px-3.5 pb-4 pt-3 sm:px-5 sm:pb-5 sm:pt-4">
            <h3 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-navy-950 sm:text-[17px]">{c.name}</h3>
            <p className="mt-0.5 text-[13px] text-navy-500 tabular">
              {c.productCount} {c.productCount === 1 ? "item" : "items"}
            </p>
            {c.description && <p className="mt-1.5 hidden pr-5 text-[13px] leading-relaxed text-navy-500 sm:line-clamp-2">{c.description}</p>}
          </div>
          <ArrowRight aria-hidden className="absolute bottom-5 right-5 h-4 w-4 -translate-x-1 text-navy-300 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:text-navy-900 group-hover:opacity-100" />
        </Link>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Featured products                                                   */
/* ------------------------------------------------------------------ */

function FeaturedSection() {
  return (
    <section className="bg-white">
      <Container>
        {/* A rule the width of the content separates it from the categories above (both on white). */}
        <div className="border-t border-navy-100 pb-16 pt-14 sm:pb-24 sm:pt-20">
          <SectionHeading
            title="Popular at the counter"
            description="The items customers ask for most often. Prices are confirmed at billing."
            action={
              <Link href="/products" className="group inline-flex items-center gap-1.5 text-sm font-semibold text-navy-950">
                <span className="link-draw">View catalogue</span> <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            }
          />
          <Suspense fallback={<ProductGridSkeleton count={8} />}>
            <FeaturedGrid />
          </Suspense>
        </div>
      </Container>
    </section>
  );
}

async function FeaturedGrid() {
  await getSiteData(); // request-time marker (connection) + graceful DB failure
  let items: Awaited<ReturnType<typeof searchPublicProducts>>["items"] = [];
  try {
    items = (await searchPublicProducts({ featured: true, pageSize: 8 })).items;
    if (!items.length) items = (await searchPublicProducts({ pageSize: 8 })).items;
  } catch (err) {
    console.error("[public] featured products unavailable", err);
  }
  if (!items.length) return <p className="text-sm text-navy-500">Our catalogue is being updated. Please call or WhatsApp us for prices.</p>;
  return <ProductGrid items={items} />;
}

/* ------------------------------------------------------------------ */
/* How ordering works                                                  */
/* ------------------------------------------------------------------ */

const STEPS = [
  { title: "Make a list", text: "Pick the exact size and quantity of each item and add it to your cart as you browse.", href: "/products", cta: "Start browsing" },
  { title: "Send it to the shop", text: "Send the list as an order request with your name and mobile number, or ask about any item on WhatsApp.", href: "/enquiry", cta: "Open your list" },
  { title: "We confirm", text: "We get back to you with availability and the final price. Pay and collect at the counter in Naswadi.", href: "/contact", cta: "How to reach us" },
];

function OrderingSection() {
  return (
    <section className="border-y border-rule bg-paper py-16 sm:py-24">
      <Container>
        <SectionHeading title="Order the way that suits you" description="Browse here, then talk to a person. No account, no online payment." />
        <ol className="grid border-t border-rule md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.title} className="flex flex-col border-b border-rule py-6 md:border-b-0 md:border-r md:px-7 md:first:pl-0 md:last:border-r-0">
              <h3 className="text-lg font-semibold tracking-[-0.01em] text-navy-950">{s.title}</h3>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-navy-500">{s.text}</p>
              <Link href={s.href} className="group mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-navy-950">
                <span className="link-draw">{s.cta}</span> <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The shop                                                            */
/* ------------------------------------------------------------------ */

function ShopSection() {
  return (
    <section className="bg-white py-16 sm:py-24">
      <Container>
        <Suspense fallback={<Skeleton className="h-80 rounded-xl" />}>
          <ShopContent />
        </Suspense>
      </Container>
    </section>
  );
}

async function ShopContent() {
  const { business } = await getSiteData();
  const wa = business.whatsapp ? whatsappLink(business.whatsapp, "Hello OM ENTERPRISE, I have an enquiry.") : null;
  return (
    <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
      <div>
        <h2 className="headline text-[1.625rem] font-bold text-navy-950 sm:text-[2rem]">Visit {business.name}</h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-navy-600">{business.about}</p>
        <div className="mt-7 flex flex-wrap gap-2.5">
          <LinkButton href="/enquiry">Send an enquiry</LinkButton>
          <LinkButton href="/about" variant="outline">
            More about us
          </LinkButton>
        </div>
      </div>
      <div className="rounded-xl border border-navy-200 bg-white shadow-card">
        <div className="border-b border-navy-100 px-6 py-5">
          <div className="label-sm text-navy-500">Address</div>
          <address className="mt-2 text-[17px] not-italic leading-snug text-navy-950">
            {addressLines(business).map((l) => (
              <span key={l} className="block">
                {l}
              </span>
            ))}
          </address>
          <a href={mapsHref(business)} target="_blank" rel="noopener noreferrer" className="group mt-3 inline-flex items-center gap-1 text-sm font-semibold text-navy-950">
            <span className="link-draw">Open in Maps</span> <ArrowUpRight className="h-3.5 w-3.5 text-gold-600 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>
        <dl className="divide-y divide-navy-100 px-6">
          {business.phone && (
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="label-sm text-navy-500">Phone</dt>
              <dd>
                <a href={telHref(business.phone)} className="link-draw tabular text-[15px] text-navy-950">
                  {formatPhone(business.phone)}
                </a>
              </dd>
            </div>
          )}
          {business.whatsapp && (
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="label-sm text-navy-500">WhatsApp</dt>
              <dd className="tabular text-[15px] text-navy-950">{formatPhone(business.whatsapp)}</dd>
            </div>
          )}
          {business.email && (
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="label-sm text-navy-500">Email</dt>
              <dd className="min-w-0 truncate text-[15px] text-navy-950">{business.email}</dd>
            </div>
          )}
          {business.openingHours && (
            <div className="flex items-center justify-between gap-4 py-3.5">
              <dt className="label-sm text-navy-500">Hours</dt>
              <dd className="text-[15px] text-navy-950">{business.openingHours}</dd>
            </div>
          )}
        </dl>
        <div className="grid gap-2 border-t border-navy-100 p-4 sm:grid-cols-2">
          {business.phone && (
            <a href={telHref(business.phone)} className="flex h-11 items-center justify-center gap-2 rounded-lg border border-navy-200 text-sm font-semibold text-navy-950 transition-colors hover:border-navy-900">
              <Phone className="h-4 w-4" /> Call the shop
            </a>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-lg border border-navy-200 text-sm font-semibold text-navy-950 transition-colors hover:border-navy-900">
              <MessageCircle className="h-4 w-4 text-emerald-600" /> WhatsApp
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
