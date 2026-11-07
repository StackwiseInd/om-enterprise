"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/**
 * Hides the floating WhatsApp button where it would cover the page's own actions: the cart, checkout,
 * order and sign-in pages, and a product page, whose bottom bar has its own WhatsApp button that names the item.
 */
export function FloatGate({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "";
  const ownActions = ["/enquiry", "/checkout", "/my-orders", "/my-profile", "/sign-in", "/sign-up"].some((p) => path.startsWith(p));
  return ownActions || /^\/products\/[^/]+\/?$/.test(path) ? null : children;
}
