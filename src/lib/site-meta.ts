/**
 * How the public site describes the shop to other apps: link previews (WhatsApp, Facebook, X) and
 * the structured data search engines read. Built only from the business settings — no opening
 * hours, ratings or other facts the shop has not entered.
 */
import { formatPhone, stateName } from "@/lib/india";
import type { Settings } from "@/lib/settings-schema";

export const SITE_NAME = "OM ENTERPRISE";
export const SITE_TAGLINE = "Your complete building solution";
export const SITE_LOGO_PATH = "/brand/om-enterprise-logo.png";

/** Open Graph fields every page shares. Titles, descriptions and pictures come from each page. */
export const SITE_OPEN_GRAPH = { type: "website", siteName: SITE_NAME, locale: "en_IN" } as const;

/**
 * The shop as a schema.org HardwareStore (a kind of LocalBusiness), for the homepage.
 * `site` is the site's absolute address without a trailing slash; `map` the shop's map link.
 */
export function businessJsonLd(b: Settings["business"], { site, map }: { site: string; map: string }) {
  return {
    "@context": "https://schema.org",
    "@type": "HardwareStore",
    "@id": `${site}/#shop`,
    name: b.name,
    url: `${site}/`,
    logo: `${site}${SITE_LOGO_PATH}`,
    image: `${site}${SITE_LOGO_PATH}`,
    telephone: b.phone ? formatPhone(b.phone) : undefined,
    email: b.email || undefined,
    address: {
      "@type": "PostalAddress",
      streetAddress: [b.addressLine1, b.addressLine2].filter(Boolean).join(", "),
      addressLocality: b.city,
      addressRegion: stateName(b.stateCode) ?? undefined,
      postalCode: b.pincode,
      addressCountry: "IN",
    },
    hasMap: map,
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so text can't close the tag. */
export function jsonLdHtml(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
