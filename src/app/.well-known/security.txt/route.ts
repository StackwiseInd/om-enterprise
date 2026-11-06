import { connection } from "next/server";
import { getSettings } from "@/server/settings";

/** RFC 9116: where to report a security problem. Uses the shop's own contact email. */
export async function GET() {
  await connection();
  const business = await getSettings("business").catch(() => null);
  const base = (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const contact = business?.email ? `mailto:${business.email}` : `${base}/contact`;
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
  const body = [`Contact: ${contact}`, `Expires: ${expires}`, "Preferred-Languages: en, hi, gu", `Canonical: ${base}/.well-known/security.txt`, `Policy: ${base}/terms`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
