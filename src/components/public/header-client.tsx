"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, MapPin, Menu, MessageCircle, Phone, Search, ShoppingCart, UserRound, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { cn } from "@/components/ui/cn";
import { formatPhone, whatsappLink } from "@/lib/india";
import { useEnquiryList } from "./cart-store";

export interface HeaderCategory {
  name: string;
  slug: string;
  icon: string | null;
  productCount: number;
  parentId: string | null;
}

export interface HeaderProps {
  categories: HeaderCategory[];
  whatsapp: string | null;
  phone: string | null;
  addressShort: string | null;
  /** The signed-in website customer, if any. */
  account?: { name: string } | null;
}

const NAV = [
  { href: "/", label: "Home" },
  { href: "/products", label: "Products" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const navItem = (active: boolean) =>
  cn(
    "relative flex h-10 items-center px-3 text-[14px] font-medium transition-colors",
    active ? "text-navy-950" : "text-navy-600 hover:text-navy-950",
    "after:absolute after:inset-x-3 after:bottom-1 after:h-[2px] after:origin-left after:bg-gold-500 after:transition-transform after:duration-300 after:ease-out",
    active ? "after:scale-x-100" : "after:scale-x-0 hover:after:scale-x-100",
  );

/** Categories as a ruled list: name on the left, product count on the right. */
function CategoryIndex({ categories, onPick, dense }: { categories: HeaderCategory[]; onPick?: () => void; dense?: boolean }) {
  return (
    <ul className={cn("grid", dense ? "gap-0" : "gap-x-8 sm:grid-cols-2")}>
      {categories.map((c) => (
        <li key={c.slug}>
          <Link
            href={`/category/${c.slug}`}
            onClick={onPick}
            className="group flex items-baseline justify-between gap-4 border-b border-navy-100 py-2.5 text-sm text-navy-900 transition-colors hover:text-navy-950"
          >
            <span className="font-medium transition-colors group-hover:text-gold-700">{c.name}</span>
            <span className="shrink-0 tabular text-[12px] text-navy-500">{c.productCount}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function NavLinks({ pathname, categories }: { pathname: string | null; categories: HeaderCategory[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const top = categories.filter((c) => !c.parentId);
  const link = (href: string, label: string) => (
    <Link key={href} href={href} aria-current={isActive(pathname, href) ? "page" : undefined} className={navItem(isActive(pathname, href))}>
      {label}
    </Link>
  );
  return (
    <nav className="hidden items-center lg:flex" aria-label="Main">
      {link("/", "Home")}
      {link("/products", "Products")}
      <div ref={ref} className="relative" onMouseLeave={() => setOpen(false)}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          onMouseEnter={() => setOpen(true)}
          aria-expanded={open}
          aria-haspopup="true"
          className={cn(navItem(!!pathname?.startsWith("/category")), "gap-1")}
        >
          Categories <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-180")} />
        </button>
        {open && top.length > 0 && (
          <div className="absolute left-1/2 top-full z-50 w-[620px] -translate-x-1/2 pt-2">
            <div className="animate-sheet-in rounded-xl border border-navy-200 bg-white p-5 shadow-lift">
              <div className="label-sm mb-2 flex items-center justify-between text-navy-500">
                <span>Categories</span>
                <span>Products</span>
              </div>
              <CategoryIndex categories={top} onPick={() => setOpen(false)} />
              <Link
                href="/products"
                onClick={() => setOpen(false)}
                className="group mt-4 flex items-center justify-between rounded-lg bg-navy-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
              >
                Browse all products
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
          </div>
        )}
      </div>
      {link("/about", "About")}
      {link("/contact", "Contact")}
    </nav>
  );
}

function ActiveNavLinks({ categories }: { categories: HeaderCategory[] }) {
  const pathname = usePathname();
  return <NavLinks pathname={pathname} categories={categories} />;
}

function EnquiryButton() {
  const { count } = useEnquiryList();
  return (
    <Link
      href="/enquiry"
      className="relative flex h-10 items-center gap-2 rounded-lg px-2.5 text-navy-800 transition-colors hover:bg-navy-50 sm:px-3"
      aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}
    >
      <ShoppingCart className="h-[18px] w-[18px]" strokeWidth={1.75} />
      <span className="hidden text-sm font-medium 2xl:inline">Cart</span>
      {count > 0 && (
        <span
          key={count}
          className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] animate-sheet-in items-center justify-center rounded-[4px] bg-navy-900 px-1 tabular text-[11px] font-semibold text-white ring-2 ring-white"
        >
          {count}
        </span>
      )}
    </Link>
  );
}

function SearchBox({ className, autoFocus, onSubmit }: { className?: string; autoFocus?: boolean; onSubmit?: () => void }) {
  return (
    <form action="/products" method="get" role="search" className={cn("relative", className)} onSubmit={onSubmit}>
      <label htmlFor={autoFocus ? "site-search-m" : "site-search"} className="sr-only">
        Search products
      </label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy-400" />
      <input
        id={autoFocus ? "site-search-m" : "site-search"}
        name="q"
        type="search"
        placeholder="Search products"
        autoFocus={autoFocus}
        className="h-10 w-full rounded-lg border border-navy-200 bg-paper/60 pl-9 pr-3 text-sm text-navy-900 placeholder:text-navy-400 transition-[border-color,box-shadow,background-color] hover:border-navy-300 focus:border-navy-800 focus:bg-white focus:outline-none focus:ring-[3px] focus:ring-gold-300/45"
      />
    </form>
  );
}

export function HeaderClient({ categories, whatsapp, phone, addressShort, account }: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const wa = whatsapp ? whatsappLink(whatsapp, "Hello OM ENTERPRISE, I have an enquiry about building materials.") : null;
  const top = categories.filter((c) => !c.parentId);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="sticky top-0 z-40">
      <div className="hidden bg-navy-950 text-navy-300 md:block">
        <div className="mx-auto flex h-9 max-w-7xl items-center justify-between gap-4 px-4 tabular text-[11.5px] sm:px-6 lg:px-8">
          <span className="flex min-w-0 items-center gap-2 truncate">
            {addressShort && (
              <>
                <MapPin className="h-3.5 w-3.5 shrink-0 text-gold-400" strokeWidth={1.75} />
                <span className="truncate">{addressShort}</span>
              </>
            )}
          </span>
          <span className="flex shrink-0 items-center gap-5">
            {phone && (
              <a href={`tel:+91${phone.replace(/\D/g, "").slice(-10)}`} className="flex items-center gap-1.5 transition-colors hover:text-white">
                <Phone className="h-3.5 w-3.5 text-gold-400" strokeWidth={1.75} /> {formatPhone(phone)}
              </a>
            )}
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 transition-colors hover:text-white">
                <MessageCircle className="h-3.5 w-3.5 text-gold-400" strokeWidth={1.75} /> WhatsApp
              </a>
            )}
          </span>
        </div>
      </div>
      <div className={cn("border-b bg-white transition-[box-shadow,border-color] duration-300", scrolled ? "border-navy-200 shadow-[0_6px_24px_-18px_rgb(13_27_48/0.45)]" : "border-navy-100")}>
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:h-[72px] lg:gap-6 lg:px-8">
          <Link href="/" className="shrink-0" aria-label="OM ENTERPRISE home">
            <span className="sm:hidden">
              <Logo size="sm" />
            </span>
            <span className="hidden sm:block">
              <Logo />
            </span>
          </Link>
          <Suspense fallback={<NavLinks pathname={null} categories={categories} />}>
            <ActiveNavLinks categories={categories} />
          </Suspense>
          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <SearchBox className="hidden w-52 md:block xl:w-60 2xl:w-72" />
            <Link
              href={account ? "/my-orders" : "/sign-in"}
              className="flex h-10 items-center gap-2 rounded-lg px-2.5 text-navy-800 transition-colors hover:bg-navy-50 sm:px-3"
              aria-label={account ? `My orders (${account.name})` : "Sign in"}
            >
              <UserRound className="h-[18px] w-[18px]" strokeWidth={1.75} />
              <span className="hidden max-w-28 truncate text-sm font-medium xl:inline">{account ? "My orders" : "Sign in"}</span>
            </Link>
            <EnquiryButton />
            {wa && (
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                className="hidden h-10 items-center gap-2 rounded-lg bg-gold-500 px-4 text-sm font-semibold text-navy-950 shadow-[inset_0_-1px_0_rgb(0_0_0/0.18)] transition-[background-color,transform] hover:bg-gold-400 active:translate-y-px sm:flex"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={2} /> WhatsApp
              </a>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-navy-800 transition-colors hover:bg-navy-50 lg:hidden"
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 animate-fade-in bg-navy-950/55" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-[min(23rem,100%)] animate-slide-in flex-col bg-white shadow-lift">
            <div className="flex items-center justify-between border-b border-navy-100 px-4 py-3">
              <Logo size="sm" compact />
              <button type="button" onClick={() => setMenuOpen(false)} className="rounded-md p-2 text-navy-700 transition-colors hover:bg-navy-50" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <SearchBox autoFocus onSubmit={() => setMenuOpen(false)} />
              <nav className="mt-5" aria-label="Mobile">
                {NAV.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center justify-between border-b border-navy-100 py-3 text-[17px] font-semibold text-navy-950"
                  >
                    {n.label}
                    <ArrowRight className="h-4 w-4 text-navy-300" />
                  </Link>
                ))}
                <Link
                  href="/enquiry"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between border-b border-navy-100 py-3 text-[17px] font-semibold text-navy-950"
                >
                  Cart
                  <ArrowRight className="h-4 w-4 text-navy-300" />
                </Link>
                <Link
                  href={account ? "/my-orders" : "/sign-in"}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center justify-between border-b border-navy-100 py-3 text-[17px] font-semibold text-navy-950"
                >
                  {account ? "My orders" : "Sign in"}
                  <ArrowRight className="h-4 w-4 text-navy-300" />
                </Link>
                {account && (
                  <Link
                    href="/my-profile"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center justify-between border-b border-navy-100 py-3 text-[17px] font-semibold text-navy-950"
                  >
                    My profile
                    <ArrowRight className="h-4 w-4 text-navy-300" />
                  </Link>
                )}
              </nav>
              {top.length > 0 && (
                <div className="mt-7">
                  <div className="label-sm mb-1 text-navy-500">Categories</div>
                  <CategoryIndex categories={top} onPick={() => setMenuOpen(false)} dense />
                </div>
              )}
            </div>
            {wa && (
              <div className="border-t border-navy-100 p-4">
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 items-center justify-center gap-2 rounded-lg bg-gold-500 text-[15px] font-semibold text-navy-950 transition-colors hover:bg-gold-400"
                >
                  <MessageCircle className="h-5 w-5" /> Chat on WhatsApp
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
