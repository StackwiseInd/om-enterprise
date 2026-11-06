import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// No-nonce CSP (keeps pages prerenderable). React escapes all rendered data; inline scripts are
// limited to Next.js runtime bootstrapping. Razorpay QR images are allowed when that gateway is used.
// `wasm` adds permission to run WebAssembly (not eval): the text recognition for scanned price
// lists runs in a worker from /ocr/, and pdf.js decodes some scan formats with WebAssembly on the
// import page. Only those two places get it.
const contentSecurityPolicy = (wasm = false) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${wasm ? " 'wasm-unsafe-eval'" : ""}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://rzp.io https://*.razorpay.com",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
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
  async headers() {
    return [
      { source: "/(.*)", headers: securityHeaders },
      { source: "/(dashboard|pos|account|login|admin)(.*)", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      // Later rules win for the same header: WebAssembly where scanned price lists are read.
      { source: "/dashboard/import", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy(true) }] },
      {
        source: "/ocr/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy(true) },
          { key: "Cache-Control", value: "public, max-age=86400" },
        ],
      },
      { source: "/pdfjs/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
    ];
  },
};

export default nextConfig;
