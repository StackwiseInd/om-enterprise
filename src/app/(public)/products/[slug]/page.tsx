import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AlertTriangle, ArrowUpRight, Info, Link2, Phone, ShieldCheck } from "lucide-react";
import { getPublicProduct } from "@/server/services/public-catalog";
import { Skeleton } from "@/components/ui/page";
import { SampleBadge } from "@/components/ui/badge";
import { Breadcrumbs, Container } from "@/components/public/section";
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
      <Container className="grid gap-10 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:py-12">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="relative">
            <ProductGallery images={p.images.map((i) => ({ url: i.url, alt: i.alt }))} name={p.name} kind={drawingKind(p.name, p.categoryIcon)} />
            {p.isSample && <SampleBadge className="absolute left-3 top-3" />}
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
          <h1 className="headline mt-2 animate-rise text-[1.875rem] font-bold text-navy-950 sm:text-[2.25rem]">
            <KeepCodes text={p.name} />
          </h1>
          {p.description && <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed text-navy-600">{p.description}</p>}

          <div className="mt-8">
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

          {specs.length > 0 && (
            <section className="mt-12">
              <div className="flex items-baseline justify-between border-b border-navy-200 pb-2">
                <h2 className="text-lg font-semibold tracking-[-0.01em] text-navy-950">Specifications</h2>
                <span className="label-sm text-navy-400">{specs.length} {specs.length === 1 ? "item" : "items"}</span>
              </div>
              <dl>
                {specs.map((s, i) => (
                  <div key={`${s.label}-${i}`} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 border-b border-navy-100 py-3 text-sm">
                    <dt className="label-sm pt-0.5 text-navy-500">{s.label}</dt>
                    <dd className="text-navy-950">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {p.warrantyInfo && (
            <section className="mt-6 flex items-start gap-3 rounded-lg border border-navy-200 bg-paper/60 p-4">
              <ShieldCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-gold-600" />
              <div>
                <h2 className="text-sm font-semibold text-navy-950">Warranty</h2>
                <p className="mt-0.5 text-sm text-navy-600">{p.warrantyInfo}</p>
              </div>
            </section>
          )}

          {p.compatible.length > 0 && (
            <section className="mt-12">
              <div className="flex items-center gap-2 border-b border-navy-200 pb-2">
                <Link2 className="h-[18px] w-[18px] text-gold-600" />
                <h2 className="text-lg font-semibold tracking-[-0.01em] text-navy-950">Compatible items</h2>
              </div>
              <p className="mt-3 text-sm text-navy-500">Items confirmed by us to work with this product. Ask us if you need a different size or type.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {p.compatible.map((c) => (
                  <li key={c.variantId}>
                    <Link
                      href={`/products/${c.slug}`}
                      className="group flex items-center justify-between gap-3 rounded-lg border border-navy-200 bg-white px-4 py-3 text-sm transition-colors hover:border-navy-900"
                    >
                      <span>
                        <span className="block font-medium text-navy-950">{c.productName}</span>
                        <span className="block tabular text-[11.5px] text-navy-500">
                          {c.variantName}
                          {c.note ? ` · ${c.note}` : ""}
                        </span>
                      </span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-navy-300 transition-[transform,color] group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-navy-900" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {business.phone && (
            <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-navy-950 px-6 py-5 text-white">
              <div>
                <div className="font-semibold">Not sure which one you need?</div>
                <div className="mt-0.5 text-sm text-navy-300">Call the shop — we&apos;ll help you choose.</div>
              </div>
              <a
                href={telHref(business.phone)}
                className="inline-flex h-11 items-center gap-2 rounded-lg bg-white px-4 tabular text-sm font-medium text-navy-950 transition-colors hover:bg-paper"
              >
                <Phone className="h-4 w-4" /> {formatPhone(business.phone)}
              </a>
            </div>
          )}
        </div>
      </Container>
    </ProductSelection>
  );
}
