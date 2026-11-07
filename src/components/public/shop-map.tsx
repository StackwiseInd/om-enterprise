import { ArrowUpRight, Navigation } from "lucide-react";
import { cn } from "@/components/ui/cn";

/**
 * The shop's Google Map, embedded so customers can see where to come and collect. It is only drawn when the
 * address is a Google Maps embed address (checked when it is saved too); the page's security policy allows
 * frames from that address only. The frame loads lazily, so it costs nothing until it scrolls into view, and it
 * is sandboxed. Under it: a plain link to open the place in Google Maps and one for directions from where the
 * customer is.
 */
export function ShopMap({
  name,
  embedUrl,
  opensHref,
  directionsHref,
  className,
  compact = false,
}: {
  /** The shop's name, for the frame's accessible title. */
  name: string;
  embedUrl: string | null | undefined;
  opensHref: string;
  directionsHref: string;
  className?: string;
  /** A shorter map for tight spots (checkout, order page). */
  compact?: boolean;
}) {
  const ok = !!embedUrl && embedUrl.startsWith("https://www.google.com/maps/embed?pb=");
  return (
    <div className={cn("overflow-hidden rounded-xl border border-navy-200 bg-white", className)}>
      {ok && (
        <div className={cn("relative w-full bg-navy-50", compact ? "aspect-[16/10]" : "aspect-[4/3] sm:aspect-[16/10]")}>
          <iframe
            src={embedUrl}
            title={`Map showing where ${name} is`}
            className="absolute inset-0 h-full w-full border-0"
            loading="lazy"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          />
        </div>
      )}
      <div className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3 text-sm font-semibold text-navy-950", ok && "border-t border-navy-100")}>
        <a href={directionsHref} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1.5">
          <Navigation className="h-4 w-4 text-gold-600" />
          <span className="link-draw">Get directions</span>
        </a>
        <a href={opensHref} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1">
          <span className="link-draw">Open in Google Maps</span> <ArrowUpRight className="h-3.5 w-3.5 text-gold-600" />
        </a>
      </div>
    </div>
  );
}
