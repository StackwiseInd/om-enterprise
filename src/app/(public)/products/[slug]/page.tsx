import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUpRight, BadgeCheck, Info, Link2, Phone, ShieldCheck, Store, UserRoundCheck } from "lucide-react";
import { getPublicProduct, searchPublicProducts } from "@/server/services/public-catalog";
import { Skeleton } from "@/components/ui/page";
import { SampleBadge } from "@/components/ui/badge";
import { Breadcrumbs, Container, SectionHeading } from "@/components/public/section";
import { ProductGrid } from "@/components/public/product-card";
import { ProductGallery } from "@/components/public/product-gallery";
import { ProductPurchase } from "@/components/public/product-purchase";
import { ProductSelection } from "@/components/public/product-selection";
import { PageFigureTransition } from "@/components/public/figure-transition";
import { drawingKind } from "@/components/public/technical-drawing";
import { KeepCodes } from "@/components/public/keep-codes";
import { getSiteData, telHref } from "@/components/public/site-data";
import { formatPhone } from "@/lib/india";
import { SITE_OPEN_GRAPH } from "@/lib/site-meta";

async function loadProduct(slug: string) {
  await connection();
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return null;
  try {
    return await getPublicProduct(slug);
  } catch (err) {
    console.error("[public] product unavailable", err);
    return null;
  }
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const p = await loadProduct(slug);
  if (!p) return { title: "Product not found" };
  const description = (p.description ?? `${p.name} — ${p.category} at OM ENTERPRISE, Naswadi.`).slice(0, 160);
  const photo = p.images[0]?.url;
  return {
    title: p.name,
    description,
    // A product with a photo shares that photo. Without one, the key is left out (not set to
    // undefined, which would clear it) so the page keeps the shop's Open Graph details and picture.
    ...(photo ? { openGraph: { ...SITE_OPEN_GRAPH, title: p.name, description, images: [photo] } } : {}),
    robots: p.isSample ? { index: false } : undefined,
  };
}

export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <ProductContent params={params} />
    </Suspense>
  );
}

function ProductSkeleton() {
  return (
    <Container className="min-h-[80vh] py-8">
      <Skeleton className="h-3 w-64" />
      <div className="mt-8 grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
        <PageFigureTransition>
          <div className="blueprint aspect-[4/3] rounded-xl border border-navy-200" />
        </PageFigureTransition>
        <div className="space-y-4">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    </Container>
  );
}

async function ProductContent({ params }: { params: PageProps<"/products/[slug]">["params"] }) {
  const { slug } = await params;
  const p = await loadProduct(slug);
  if (!p) notFound();
  const { business, website } = await getSiteData();
  const specs = [
    ...(p.manufacturer ? [{ label: "Manufacturer", value: p.manufacturer }] : []),
    ...(p.model ? [{ label: "Model", value: p.model }] : []),
    ...p.specifications,
  ];
  // A short summary near the price, only when the full sheet below has more than it shows.
  const keyDetails = p.specifications.length > 4 ? p.specifications.slice(0, 4) : [];

  return (
    <ProductSelection initialId={p.variants[0]?.id ?? ""}>
      <div className="border-b border-navy-100">
        <Container className="py-4">
          <Breadcrumbs
            items={[
              { href: "/", label: "Home" },
              { href: "/products", label: "Products" },
              { href: `/category/${p.categorySlug}`, label: p.category },
              { label: p.name },
            ]}
          />
        </Container>
      </div>
      {p.isSample && (
        <Container className="mt-5">
          <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50/80 px-4 py-3 text-sm text-red-950" role="note">
            <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-red-600" />
            <div>
              <span className="font-semibold">Demonstration product — not real product information.</span> Prices, specifications and availability shown
              here are sample data for preview and staff training only.
            </div>
          </div>
        </Container>
      )}
      <Container className="grid gap-8 py-6 sm:py-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:py-12">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="relative">
            <ProductGallery images={p.images.map((i) => ({ url: i.url, alt: i.alt, variantId: i.variantId }))} name={p.name} kind={drawingKind(p.name, p.categoryIcon)} />
            {p.isSample && <SampleBadge className="absolute left-3 top-3 z-10" />}
          </div>
        </div>
        <div>
          <div className="label-sm flex flex-wrap items-center gap-2">
            {p.brand && (
              <Link href={`/products?brand=${encodeURIComponent(p.brandSlug ?? "")}`} className="text-gold-700 transition-colors hover:text-gold-600">
                {p.brand}
              </Link>
            )}
            {p.brand && <span className="text-navy-300">/</span>}
            <Link href={`/category/${p.categorySlug}`} className="text-navy-500 transition-colors hover:text-navy-900">
              {p.category}
            </Link>
          </div>
          <h1 className="headline mt-2 animate-rise text-[1.75rem] font-bold text-navy-950 sm:text-[2.25rem]">
            <KeepCodes text={p.name} />
          </h1>
          {p.variants.length > 1 && (
            <p className="mt-2 tabular text-[13px] text-navy-500">
              {p.variants.length} sizes{p.model ? ` · Model ${p.model}` : ""}
            </p>
          )}
          {p.description && <p className="mt-4 whitespace-pre-line text-[15px] leading-relaxed text-navy-600">{p.description}</p>}

          {keyDetails.length > 0 && (
            <div className="mt-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3.5 border-y border-navy-100 py-4">
                {keyDetails.map((s, i) => (
                  <div key={`${s.label}-${i}`} className="min-w-0">
                    <dt className="label-sm text-navy-500">{s.label}</dt>
                    <dd className="mt-0.5 text-sm leading-snug text-navy-950">{s.value}</dd>
                  </div>
                ))}
              </dl>
              <a href="#specifications" className="group mt-2.5 inline-flex items-center gap-1 text-[13px] font-semibold text-navy-900">
                <span className="link-draw">All {specs.length} specifications</span> <ArrowDown className="h-3.5 w-3.5 transition-transform group-hover:translate-y-0.5" />
              </a>
            </div>
          )}

          <div className="mt-7">
            <ProductPurchase
              productName={p.name}
              slug={p.slug}
              variantAttributes={p.variantAttributes}
              variants={p.variants}
              whatsapp={business.whatsapp || null}
              enquiriesEnabled={website.enquiriesEnabled}
            />
          </div>

          {website.priceNote && (
            <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-navy-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {website.priceNote}
            </p>
          )}

          {/* How buying works here, as the homepage describes it: no claims beyond that. */}
          <ul className="mt-6 grid gap-3 border-t border-navy-100 pt-5 text-[13px] leading-snug text-navy-600 sm:grid-cols-3">
            <li className="flex items-start gap-2.5">
              <BadgeCheck className="mt-px h-4 w-4 shrink-0 text-navy-400" /> We confirm availability and the final price
            </li>
            <li className="flex items-start gap-2.5">
              <Store className="mt-px h-4 w-4 shrink-0 text-navy-400" /> Pay and collect at the counter in {business.city}
            </li>
            <li className="flex items-start gap-2.5">
              <UserRoundCheck className="mt-px h-4 w-4 shrink-0 text-navy-400" /> No account or online payment needed
            </li>
          </ul>
        </div>
      </Container>

      {(specs.length > 0 || p.warrantyInfo || business.phone) && (
        <section className="border-t border-navy-100">
          <Container className={specs.length ? "py-12 sm:py-16" : "py-10"}>
            {specs.length > 0 && (
              <div id="specifications" className="mb-5 flex scroll-mt-28 items-baseline gap-3">
                <h2 className="headline text-[1.375rem] font-bold text-navy-950 sm:text-[1.625rem]">Specifications</h2>
                <span className="tabular text-[13px] text-navy-500">
                  {specs.length} {specs.length === 1 ? "detail" : "details"}
                </span>
              </div>
            )}
            <div className={specs.length ? "grid gap-10 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-14" : "grid gap-4 md:grid-cols-2"}>
              {specs.length > 0 && (
                <dl className="overflow-hidden rounded-xl border border-navy-200 self-start">
                  {specs.map((s, i) => (
                    <div key={`${s.label}-${i}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] border-b border-navy-100 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                      <dt className="bg-paper/70 px-4 py-3 text-navy-500">{s.label}</dt>
                      <dd className="px-4 py-3 text-navy-950">{s.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <aside className={specs.length ? "space-y-4" : "contents"}>
                {p.warrantyInfo && (
                  <div className="flex items-start gap-3 rounded-xl border border-navy-200 bg-white p-5">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-gold-600" />
                    <div>
                      <h2 className="text-sm font-semibold text-navy-950">Warranty</h2>
                      <p className="mt-1 text-sm leading-relaxed text-navy-600">{p.warrantyInfo}</p>
                    </div>
                  </div>
                )}
                {business.phone && (
                  <div className="rounded-xl bg-navy-950 p-5 text-white">
                    <div className="font-semibold">Not sure which one you need?</div>
                    <div className="mt-1 text-sm leading-relaxed text-navy-300">Call the shop — we&apos;ll help you choose the right size and fittings.</div>
                    <a
                      href={telHref(business.phone)}
                      className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-white px-4 tabular text-sm font-semibold text-navy-950 transition-colors hover:bg-paper"
                    >
                      <Phone className="h-4 w-4" /> {formatPhone(business.phone)}
                    </a>
                  </div>
                )}
              </aside>
            </div>
          </Container>
        </section>
      )}

      {p.compatible.length > 0 && (
        <section className="border-t border-navy-100">
          <Container className="py-12 sm:py-16">
            <div className="flex items-center gap-2">
              <Link2 className="h-[18px] w-[18px] text-gold-600" />
              <h2 className="headline text-[1.375rem] font-bold text-navy-950 sm:text-[1.625rem]">Compatible items</h2>
            </div>
            <p className="mt-2 text-sm text-navy-500">Items confirmed by us to work with this product. Ask us if you need a different size or type.</p>
            <ul className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {p.compatible.map((c) => (
                <li key={c.variantId}>
                  <Link
                    href={`/products/${c.slug}`}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-navy-200 bg-white px-4 py-3 text-sm transition-colors hover:border-navy-900"
                  >
                    <span>
                      <span className="block font-medium text-navy-950">{c.productName}</span>
                      <span className="block tabular text-xs text-navy-500">
                        {c.variantName}
                        {c.note ? ` · ${c.note}` : ""}
                      </span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-navy-300 transition-[transform,color] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-navy-900" />
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}

      <Suspense fallback={null}>
        <MoreInCategory category={p.categorySlug} categoryName={p.category} exclude={p.slug} />
      </Suspense>
    </ProductSelection>
  );
}

/** Up to four other items from the same category, as catalogue cards. */
async function MoreInCategory({ category, categoryName, exclude }: { category: string; categoryName: string; exclude: string }) {
  let items: Awaited<ReturnType<typeof searchPublicProducts>>["items"] = [];
  try {
    items = (await searchPublicProducts({ category, pageSize: 5 })).items.filter((i) => i.slug !== exclude).slice(0, 4);
  } catch (err) {
    console.error("[public] related products unavailable", err);
  }
  if (!items.length) return null;
  return (
    <section className="border-t border-navy-100">
      <Container className="py-12 sm:py-16">
        <SectionHeading
          title={`More in ${categoryName}`}
          action={
            <Link href={`/category/${category}`} className="group inline-flex items-center gap-1.5 text-sm font-semibold text-navy-950">
              <span className="link-draw">See all</span> <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          }
        />
        <ProductGrid items={items} className="lg:grid-cols-4" />
      </Container>
    </section>
  );
}
