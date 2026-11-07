import Link from "next/link";
import { Package, UserRound } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { formatPhone } from "@/lib/india";
import { ShopSignOut } from "./shop-sign-out";

/** The two pages of a customer's account, with who is signed in and Sign out. */
export function AccountTabs({ active, name, mobile }: { active: "orders" | "profile"; name: string; mobile: string }) {
  const tab = (key: "orders" | "profile", href: string, label: string, Icon: typeof Package) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold transition-colors",
        active === key ? "bg-navy-900 text-white" : "text-navy-700 hover:bg-navy-50",
      )}
    >
      <Icon className="h-4 w-4" strokeWidth={2} /> {label}
    </Link>
  );
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="My account" className="flex gap-1 rounded-xl border border-navy-200 bg-white p-1">
        {tab("orders", "/my-orders", "My orders", Package)}
        {tab("profile", "/my-profile", "My profile", UserRound)}
      </nav>
      <div className="flex flex-wrap items-center gap-3 text-sm text-navy-600">
        <span>
          <span className="font-semibold text-navy-950">{name}</span> · <span className="tabular">{formatPhone(mobile)}</span>
        </span>
        <ShopSignOut />
      </div>
    </div>
  );
}
