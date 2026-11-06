import type { Metadata } from "next";
import { Suspense } from "react";
import { CatalogueResults, parseCatalogueQuery } from "@/components/public/catalogue-results";
import { ProductGridSkeleton } from "@/components/public/product-card";
import { Container, PageIntro } from "@/components/public/section";
import { Skeleton } from "@/components/ui/page";

export const metadata: Metadata = {
  title: "Products",
  description: "Browse paints, water tanks, bathware, CPVC / PVC / UPVC / SWR pipes and fittings, and plumbing accessories at OM ENTERPRISE, Naswadi.",
};

export default function ProductsPage({ searchParams }: PageProps<"/products">) {
  return (
    <>
      <PageIntro
        crumbs={[{ href: "/", label: "Home" }, { label: "Products" }]}
        title="Product catalogue"
        description="Every size we list, with its SKU. Add items to your cart and pay online by UPI, or send it as a request — we confirm availability and the final bill amount when you contact us or visit the shop."
      />
      <Container className="py-8 sm:py-10">
        <Suspense
          fallback={
            <div className="space-y-5">
              <Skeleton className="h-11 rounded-lg" />
              <Skeleton className="h-5 w-48" />
              <ProductGridSkeleton />
            </div>
          }
        >
          <Results searchParams={searchParams} />
        </Suspense>
      </Container>
    </>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/products">["searchParams"] }) {
  const query = parseCatalogueQuery(await searchParams);
  return <CatalogueResults query={query} />;
}
