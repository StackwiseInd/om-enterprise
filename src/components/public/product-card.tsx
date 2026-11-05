import { ArrowRight } from "lucide-react";
import type { PublicProductCard } from "@/server/services/public-catalog";
import { SampleBadge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";
import { PriceTag } from "./price";
import { TechnicalDrawing, drawingKind } from "./technical-drawing";
import { CardFigureTransition, ProductLink } from "./figure-transition";
import { KeepCodes } from "./keep-codes";

/** The product's figure: its photo, or a technical drawing. Morphs into the product page. */
export function ProductFigure({ p, className }: { p: Pick<PublicProductCard, "slug" | "name" | "image" | "categoryIcon">; className?: string }) {
  return (
    <CardFigureTransition slug={p.slug}>
      <div className={cn("relative overflow-hidden", p.image ? "bg-white" : "blueprint", className)}>
        {p.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- served by /uploads (already re-encoded WebP)
          <img src={p.image} alt={p.name} loading="lazy" className="h-full w-full object-contain p-4 transition-transform duration-500 ease-out group-hover:scale-[1.03]" />
        ) : (
          <TechnicalDrawing
            kind={drawingKind(p.name, p.categoryIcon)}
            className="absolute inset-0 m-auto h-[82%] w-[82%] transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        )}
      </div>
    </CardFigureTransition>
  );
}

export function ProductCard({ p, index = 0 }: { p: PublicProductCard; index?: number }) {
  return (
    <ProductLink
      slug={p.slug}
      style={{ ["--i" as string]: index }}
      className="group relative flex flex-col border-b border-r border-navy-100 bg-white transition-colors duration-200 hover:bg-paper/50 focus-visible:z-10"
    >
      <ProductFigure p={p} className="aspect-[4/3] border-b border-navy-100" />
      {p.isSample && <SampleBadge className="absolute left-3 top-3" />}
      <div className="flex flex-1 flex-col px-3 pb-3.5 pt-3 sm:px-4 sm:pb-4 sm:pt-3.5">
        <div className="label-sm truncate text-gold-700">{p.brand ?? p.category}</div>
        <h3 className="mt-1.5 line-clamp-3 text-[14px] font-semibold leading-snug tracking-[-0.01em] text-navy-950 sm:text-[15px]">
          <KeepCodes text={p.name} />
        </h3>
        {p.brand && <div className="mt-1 truncate text-xs text-navy-500">{p.category}</div>}
        <div className="mt-auto flex items-start justify-between gap-2 pt-4 sm:pt-5">
          <div className="min-w-0">
            <PriceTag price={p.priceFrom} from={p.variantCount > 1} note={p.variantCount > 1 ? `${p.variantCount} sizes` : undefined} />
          </div>
          <ArrowRight aria-hidden className="mb-0.5 h-4 w-4 shrink-0 -translate-x-1 text-navy-300 transition-[transform,color] duration-200 group-hover:translate-x-0 group-hover:text-navy-900" />
        </div>
      </div>
    </ProductLink>
  );
}

const ruledGrid = "grid grid-cols-2 overflow-hidden rounded-xl border-l border-t border-navy-100 bg-white lg:grid-cols-3 xl:grid-cols-4";

/** Ruled grid: each cell draws its right and bottom hairline, like a printed catalogue page. */
export function ProductGrid({ items }: { items: PublicProductCard[] }) {
  return (
    <div className={`stagger ${ruledGrid}`}>
      {items.map((p, i) => (
        <ProductCard key={p.slug} p={p} index={i} />
      ))}
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={ruledGrid} aria-busy="true" aria-label="Loading products">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-r border-navy-100 bg-white">
          <div className="blueprint aspect-[4/3] border-b border-navy-100" />
          <div className="space-y-2.5 p-4">
            <div className="h-2.5 w-16 animate-pulse rounded-sm bg-navy-100" />
            <div className="h-4 w-3/4 animate-pulse rounded-sm bg-navy-100" />
            <div className="h-4 w-24 animate-pulse rounded-sm bg-navy-100" />
          </div>
        </div>
      ))}
    </div>
  );
}
