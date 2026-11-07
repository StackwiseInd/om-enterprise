import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getSettings } from "@/server/settings";
import { getPublicCategories } from "@/server/services/public-catalog";
import { stateName } from "@/lib/india";
import { SETTINGS_DEFAULTS, type Settings } from "@/lib/settings-schema";

/**
 * Business details for the public site, read at request time. If the database is unreachable
 * the site still renders with the configured defaults instead of failing completely.
 */
export const getSiteData = cache(async (): Promise<{
  business: Settings["business"];
  website: Settings["website"];
  categories: Awaited<ReturnType<typeof getPublicCategories>>;
  dbOk: boolean;
}> => {
  await connection();
  try {
    const [business, website, categories] = [await getSettings("business"), await getSettings("website"), await getPublicCategories()];
    return { business, website, categories, dbOk: true };
  } catch (err) {
    console.error("[public] site data unavailable", err);
    return { business: SETTINGS_DEFAULTS.business, website: SETTINGS_DEFAULTS.website, categories: [], dbOk: false };
  }
});

export function addressLines(b: Settings["business"]): string[] {
  return [b.addressLine1, b.addressLine2, `${b.city}${b.district ? `, Dist. ${b.district}` : ""}`, `${stateName(b.stateCode) ?? ""} ${b.pincode}`.trim()].filter(Boolean);
}

export function addressShort(b: Settings["business"]): string {
  return `${b.addressLine1}, ${b.city}, ${stateName(b.stateCode) ?? ""} ${b.pincode}`.replace(/\s+/g, " ").trim();
}

/** The configured map link, or a Maps search for the shop's address. */
export function mapsHref(b: Settings["business"]): string {
  if (b.mapUrl) return b.mapUrl;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name}, ${addressShort(b)}`)}`;
}

/** Google's turn-by-turn directions to the shop, from wherever the customer is. */
export function directionsHref(b: Settings["business"]): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${b.name}, ${addressShort(b)}`)}`;
}

export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `tel:+91${digits.slice(-10)}`;
}
