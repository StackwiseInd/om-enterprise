"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { ChevronLeft, ChevronRight, Expand, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { TechnicalDrawing, type DrawingKind } from "./technical-drawing";
import { PageFigureTransition } from "./figure-transition";
import { useProductSelection } from "./product-selection";

export interface GalleryImage {
  url: string;
  alt: string | null;
  /** Set when the photo shows one size; choosing that size brings the photo up. */
  variantId?: string | null;
}

/**
 * The product's figure: its photos, or a line drawing when there are none. Photos sit on a
 * horizontal scroll-snap track, so a phone swipes them natively; arrows, thumbnails, dots and the
 * arrow keys move the same track. Tapping a photo opens it full screen, where it can be zoomed.
 * Takes over the opened catalogue card's figure as the page loads.
 */
export function ProductGallery({ images, name, kind }: { images: GalleryImage[]; name: string; kind: DrawingKind }) {
  if (!images.length) return <DrawingFigure name={name} kind={kind} />;
  return <PhotoGallery images={images} name={name} />;
}

function DrawingFigure({ name, kind }: { name: string; kind: DrawingKind }) {
  return (
    <figure>
      <PageFigureTransition>
        <div className="blueprint relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-navy-200">
          <TechnicalDrawing kind={kind} animate title={`${name} — line drawing`} className="absolute inset-0 m-auto h-[72%] w-[78%]" />
        </div>
      </PageFigureTransition>
      <figcaption className="mt-2.5 text-xs text-navy-500">Illustration, not to scale. Ask us for a photo of the exact item.</figcaption>
    </figure>
  );
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A scroll-snap track and the slide in view. `goTo` scrolls; the index follows the scroll. */
function useSlider(count: number) {
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [index, setIndex] = useState(0);

  const goTo = useCallback(
    (i: number, instant?: boolean) => {
      const el = track.current;
      if (!el) return;
      const next = Math.max(0, Math.min(count - 1, i));
      el.scrollTo({ left: next * el.clientWidth, behavior: instant || prefersReducedMotion() ? "auto" : "smooth" });
    },
    [count],
  );

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = track.current;
      if (el?.clientWidth) setIndex(Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / el.clientWidth))));
    });
  }, [count]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const onKeyDown = (e: KeyboardEvent) => {
    const keys: Record<string, number> = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: count - 1 };
    if (e.key in keys) {
      e.preventDefault();
      goTo(keys[e.key]);
    }
  };

  return { track, index, goTo, onScroll, onKeyDown };
}

const trackClass = "flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

function Arrow({ dir, onClick, disabled, className }: { dir: "prev" | "next"; onClick: () => void; disabled: boolean; className?: string }) {
  const Icon = dir === "prev" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "prev" ? "Previous image" : "Next image"}
      className={cn(
        "absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-navy-200 bg-white/95 text-navy-900 shadow-card transition-[opacity,border-color,transform] duration-200 hover:border-navy-900 active:scale-95 disabled:pointer-events-none disabled:opacity-0",
        dir === "prev" ? "left-3" : "right-3",
        className,
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function PhotoGallery({ images, name }: { images: GalleryImage[]; name: string }) {
  const count = images.length;
  const { track, index, goTo, onScroll, onKeyDown } = useSlider(count);
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const strip = useRef<HTMLDivElement>(null);

  // Choosing a size that has its own photo brings that photo up (instantly on first load).
  const { selectedId } = useProductSelection("");
  const firstSync = useRef(true);
  useEffect(() => {
    const i = images.findIndex((img) => img.variantId && img.variantId === selectedId);
    if (i >= 0) goTo(i, firstSync.current);
    firstSync.current = false;
  }, [selectedId, images, goTo]);

  // Keep the active thumbnail in view when there are more than fit.
  useEffect(() => {
    const s = strip.current;
    const t = s?.children[index] as HTMLElement | undefined;
    if (!s || !t || s.scrollWidth <= s.clientWidth) return;
    if (t.offsetLeft < s.scrollLeft || t.offsetLeft + t.offsetWidth > s.scrollLeft + s.clientWidth) {
      s.scrollTo({ left: t.offsetLeft - 8, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }, [index]);

  return (
    <div>
      <div role="region" aria-roledescription="carousel" aria-label={`Photos of ${name}`} onKeyDown={onKeyDown} className="relative">
        <PageFigureTransition>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-navy-200 bg-white">
            <div ref={track} onScroll={onScroll} className={trackClass}>
              {images.map((img, i) => (
                <div key={img.url} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${count}`} className="h-full w-full shrink-0 snap-center snap-always">
                  <button
                    type="button"
                    onClick={() => setViewerAt(i)}
                    tabIndex={i === index ? 0 : -1}
                    aria-label={`${img.alt ?? name} — open full screen`}
                    className="flex h-full w-full cursor-zoom-in items-center justify-center p-5 sm:p-8"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- served by /uploads (re-encoded WebP) */}
                    <img
                      src={img.url}
                      alt={img.alt ?? name}
                      draggable={false}
                      loading={i === 0 ? "eager" : "lazy"}
                      className="max-h-full max-w-full select-none object-contain transition-transform duration-500 ease-out-quart hover:scale-[1.02]"
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </PageFigureTransition>

        <button
          type="button"
          onClick={() => setViewerAt(index)}
          aria-label="View full screen"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-lg border border-navy-200 bg-white/95 text-navy-700 shadow-card transition-colors hover:border-navy-900 hover:text-navy-950"
        >
          <Expand className="h-4 w-4" />
        </button>

        {count > 1 && (
          <>
            <Arrow dir="prev" onClick={() => goTo(index - 1)} disabled={index === 0} className="hidden sm:flex" />
            <Arrow dir="next" onClick={() => goTo(index + 1)} disabled={index === count - 1} className="hidden sm:flex" />
            <span className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md border border-navy-100 bg-white/95 px-2 py-0.5 tabular text-xs text-navy-600" aria-live="polite">
              {index + 1} / {count}
            </span>
          </>
        )}
      </div>

      {count > 1 && (
        <>
          {/* Phones: dots under the photo (swipe to move). */}
          <div className="mt-3 flex justify-center gap-1.5 sm:hidden">
            {images.map((img, i) => (
              <button
                key={img.url}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show image ${i + 1}`}
                aria-pressed={i === index}
                className="flex h-6 items-center px-0.5"
              >
                <span className={cn("block h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out-quart", i === index ? "w-5 bg-navy-900" : "w-1.5 bg-navy-200")} />
              </button>
            ))}
          </div>
          {/* Larger screens: thumbnails. */}
          <div ref={strip} className="relative mt-3 hidden gap-2 overflow-x-auto pb-1 [scrollbar-width:thin] sm:flex">
            {images.map((img, i) => (
              <button
                key={img.url}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show image ${i + 1}`}
                aria-pressed={i === index}
                className={cn(
                  "h-[72px] w-[72px] shrink-0 overflow-hidden rounded-lg border bg-white p-1 transition-[border-color,box-shadow] duration-200",
                  i === index ? "border-navy-900 ring-2 ring-gold-300/60" : "border-navy-200 hover:border-navy-500",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" loading="lazy" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        </>
      )}

      {viewerAt !== null && (
        <Viewer
          images={images}
          name={name}
          start={viewerAt}
          onClose={(at) => {
            setViewerAt(null);
            goTo(at, true);
          }}
        />
      )}
    </div>
  );
}

/** Full-screen photos: swipe, arrows or keys to move; click or tap a photo to zoom, move to look around. */
function Viewer({ images, name, start, onClose }: { images: GalleryImage[]; name: string; start: number; onClose: (at: number) => void }) {
  const count = images.length;
  const dialog = useRef<HTMLDialogElement>(null);
  const { track, index, goTo, onScroll, onKeyDown } = useSlider(count);
  // Zoom belongs to one photo; moving to another photo shows it unzoomed.
  const [zoom, setZoom] = useState<{ at: number; x: number; y: number } | null>(null);
  const zoomed = zoom?.at === index;

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    d.showModal();
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => goTo(start, true));
    return () => {
      cancelAnimationFrame(raf);
      root.style.overflow = overflow;
      // Also when the route is hidden (Next keeps previous routes in a hidden <Activity>).
      if (d.open) d.close();
    };
  }, [goTo, start]);

  const origin = (e: MouseEvent<HTMLElement> | PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)), y: Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)) };
  };

  return (
    <dialog
      ref={dialog}
      aria-label={`Photos of ${name}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose(index);
      }}
      onKeyDown={(e) => {
        if (!zoomed) onKeyDown(e);
      }}
      className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-white p-0 text-navy-900"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-4 border-b border-navy-100 px-4 py-2.5 sm:px-6">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-navy-950">{name}</div>
            <div className="tabular text-xs text-navy-500">
              {index + 1} / {count}
              {images[index]?.alt ? ` · ${images[index].alt}` : ""}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setZoom(zoomed ? null : { at: index, x: 50, y: 50 })}
              aria-label={zoomed ? "Zoom out" : "Zoom in"}
              aria-pressed={zoomed}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-950"
            >
              {zoomed ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => onClose(index)}
              aria-label="Close"
              className="flex h-10 w-10 items-center justify-center rounded-lg text-navy-700 transition-colors hover:bg-navy-50 hover:text-navy-950"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 bg-paper/40">
          <div ref={track} onScroll={onScroll} className={cn(trackClass, zoomed && "touch-none overflow-x-hidden")}>
            {images.map((img, i) => {
              const on = zoom?.at === i;
              return (
                <div key={img.url} className="flex h-full w-full shrink-0 snap-center snap-always items-center justify-center overflow-hidden p-4 sm:p-10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={img.url}
                    alt={img.alt ?? name}
                    draggable={false}
                    onClick={(e) => setZoom(on ? null : { at: i, ...origin(e) })}
                    onPointerMove={(e) => {
                      if (on) setZoom({ at: i, ...origin(e) });
                    }}
                    style={on ? { transform: "scale(2.25)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
                    className={cn(
                      "max-h-full max-w-full select-none object-contain transition-transform duration-300 ease-out-quart",
                      on ? "cursor-zoom-out" : "cursor-zoom-in",
                    )}
                  />
                </div>
              );
            })}
          </div>
          {count > 1 && !zoomed && (
            <>
              <Arrow dir="prev" onClick={() => goTo(index - 1)} disabled={index === 0} className="sm:left-6 sm:h-12 sm:w-12" />
              <Arrow dir="next" onClick={() => goTo(index + 1)} disabled={index === count - 1} className="sm:right-6 sm:h-12 sm:w-12" />
            </>
          )}
        </div>

        {count > 1 && (
          <div className="flex justify-center gap-2 overflow-x-auto border-t border-navy-100 px-4 py-3">
            {images.map((img, i) => (
              <button
                key={img.url}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show image ${i + 1}`}
                aria-pressed={i === index}
                className={cn(
                  "h-14 w-14 shrink-0 overflow-hidden rounded-md border bg-white p-0.5 transition-[border-color,box-shadow] duration-200 sm:h-16 sm:w-16",
                  i === index ? "border-navy-900 ring-2 ring-gold-300/60" : "border-navy-200 hover:border-navy-500",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" loading="lazy" className="h-full w-full object-contain" />
              </button>
            ))}
          </div>
        )}
      </div>
    </dialog>
  );
}
