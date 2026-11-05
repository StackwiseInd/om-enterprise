import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { SITE_NAME, SITE_OPEN_GRAPH } from "@/lib/site-meta";
import "./globals.css";

// Self-hosted from npm (OFL) — no network access needed at build time, and the CSP allows
// fonts from this origin only. One family for everything, the same as the printed bill.
// Latin-ext comes first: it supplies the rupee sign (U+20B9).
const roboto = localFont({
  src: [
    { path: "../../node_modules/@fontsource-variable/roboto/files/roboto-latin-ext-wght-normal.woff2", style: "normal" },
    { path: "../../node_modules/@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2", style: "normal" },
  ],
  weight: "100 900",
  variable: "--font-roboto",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_BASE_URL ?? "http://localhost:3000"),
  title: { default: "OM ENTERPRISE — Your Complete Building Solution", template: "%s · OM ENTERPRISE" },
  description:
    "OM ENTERPRISE, Naswadi (Gujarat): paints, water tanks, bathware & sanitary fittings, CPVC / PVC / UPVC / SWR pipes and fittings, plumbing accessories and building materials.",
  applicationName: SITE_NAME,
  // Link previews. Each page's own title and description fill og:/twitter: title and description,
  // and the picture is app/opengraph-image.tsx unless a page sets its own (a product photo).
  openGraph: SITE_OPEN_GRAPH,
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: "#0d1b30",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className={`${roboto.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
