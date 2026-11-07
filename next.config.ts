import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// No-nonce CSP (keeps pages prerenderable). React escapes all rendered data; inline scripts are
// limited to Next.js runtime bootstrapping. Razorpay QR images are allowed when that gateway is used.
// `razorpay` adds exactly what Razorpay's checkout window needs (checkout.js, its iframe, its log endpoint).
// A page's policy is fixed when its document loads, and customers reach the order page by in-page navigation,
// so the whole public site allows it; the staff areas (dashboard, POS, sign-in, admin) never do.
// `wasm` adds permission to run WebAssembly (not eval): the text recognition for scanned price
// lists runs in a worker from /ocr/, and pdf.js decodes some scan formats with WebAssembly on the
// import page. Only those two places get it.
const contentSecurityPolicy = (wasm = false, razorpay = true) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${wasm ? " 'wasm-unsafe-eval'" : ""}${razorpay ? " https://checkout.razorpay.com" : ""}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://rzp.io https://*.razorpay.com",
    "font-src 'self'",
    `connect-src 'self'${razorpay ? " https://lumberjack.razorpay.com https://api.razorpay.com" : ""}`,
    // Frames: the shop's Google Map and Razorpay's payment window, on the public site only.
    ...(razorpay ? ["frame-src https://www.google.com/maps/embed https://api.razorpay.com https://checkout.razorpay.com"] : []),
    "object-src 'none'",
    "base-uri 'self'",
    `form-action 'self'${razorpay ? " https://api.razorpay.com" : ""}`,
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

/** Permissions-Policy: the public site lets Razorpay's window use the Payment Request API (Google Pay etc.); staff pages
 *  keep the camera for the POS barcode scanner and never allow payments. */
const permissionsPolicy = (staff: boolean) =>
  [
    staff ? "camera=(self)" : "camera=()",
    "microphone=()",
    "geolocation=()",
    staff ? "payment=()" : 'payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")',
    "usb=()",
    "serial=()",
    "accelerometer=()",
    "gyroscope=()",
    "magnetometer=()",
    "interest-cohort=()",
  ].join(", ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: permissionsPolicy(false) },
  // Razorpay's window may open a bank page in a pop-up that must be able to talk back to this page.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Self-hosting (Docker) ships the standalone server; Vercel packages the app itself.
  output: process.env.VERCEL ? undefined : "standalone",
  poweredByHeader: false,
  // pdfkit reads its own font metric files at runtime; keep it out of the bundle.
  serverExternalPackages: ["pdfkit"],
  // Never ship secrets, backups, uploads or dev-only files in the standalone server bundle.
  outputFileTracingExcludes: {
    "/**": [
      "./.env*",
      "./backups/**",
      "./storage/**",
      "./tests/**",
      "./test-results/**",
      "./playwright-report/**",
      "./scripts/**",
    ],
  },
  // Bill PDFs read their fonts and the logo from assets/ at runtime: every route that makes one.
  outputFileTracingIncludes: {
    "/api/shop/orders/[number]/receipt": ["./assets/fonts/**", "./assets/brand/om-enterprise-logo.jpg"],
    "/api/admin/online-orders/[id]/receipt": ["./assets/fonts/**", "./assets/brand/om-enterprise-logo.jpg"],
    "/api/documents/[id]/pdf": ["./assets/fonts/**", "./assets/brand/om-enterprise-logo.jpg"],
    "/api/documents/[id]/email": ["./assets/fonts/**", "./assets/brand/om-enterprise-logo.jpg"],
    "/api/documents/[id]/whatsapp": ["./assets/fonts/**", "./assets/brand/om-enterprise-logo.jpg"],
    "/d/[token]/pdf": ["./assets/fonts/**", "./assets/brand/om-enterprise-logo.jpg"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The names payment-gateway reviewers and customers tend to try for the legal pages.
  async redirects() {
    const to = (sources: string[], destination: string) => sources.map((source) => ({ source, destination, permanent: true }));
    return [
      ...to(["/terms-and-conditions", "/terms-of-service", "/terms-conditions", "/tnc"], "/terms"),
      ...to(["/privacy-policy"], "/privacy"),
      ...to(["/refunds", "/refund", "/cancellation-policy", "/cancellation-and-refund-policy", "/refund-and-cancellation", "/cancellation-refund-policy"], "/refund-policy"),
      ...to(["/shipping-policy", "/delivery-policy", "/shipping", "/pickup", "/shipping-and-delivery"], "/pickup-policy"),
      ...to(["/contact-us"], "/contact"),
      ...to(["/about-us"], "/about"),
    ];
  },
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      {
        source: "/(dashboard|pos|account|login|admin)(.*)",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy(false, false) },
          { key: "Permissions-Policy", value: permissionsPolicy(true) },
        ],
      },
      // Later rules win for the same header: staff areas never allow Razorpay or payments...
      // ...and, on top of that, WebAssembly where scanned price lists are read.
      { source: "/dashboard/import", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy(true, false) }] },
      {
        source: "/ocr/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy(true, false) },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
      { source: "/pdfjs/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default nextConfig;
