import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { getPublicCategories, searchPublicProducts } from "@/server/services/public-catalog";

/** Generated at request time (never at build), so building the app needs no database. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const now = new Date();
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/products`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/contact`, changeFrequency: "monthly", priority: 0.6 },
    ...["/terms", "/refund-policy", "/pickup-policy", "/privacy"].map((path) => ({ url: `${base}${path}`, changeFrequency: "yearly" as const, priority: 0.2 })),
  ];
  try {
    const categories = await getPublicCategories();
    for (const c of categories) pages.push({ url: `${base}/category/${c.slug}`, changeFrequency: "weekly", priority: 0.7 });
    for (let page = 1; page <= 50; page++) {
      const res = await searchPublicProducts({ page, pageSize: 60 });
      // Demonstration products are never offered to search engines.
      for (const p of res.items) if (!p.isSample) pages.push({ url: `${base}/products/${p.slug}`, changeFrequency: "weekly", priority: 0.8 });
      if (page * res.pageSize >= res.total) break;
    }
  } catch (err) {
    console.error("[sitemap] catalogue unavailable", err);
  }
  return pages;
}
