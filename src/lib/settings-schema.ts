/**
 * Business settings: one validated JSON document per section, stored in `settings`.
 * Unknown/missing keys fall back to DEFAULTS. Every change is versioned and audited.
 */
import { z } from "zod";
import { DOC_PREFIX_RE, isValidStateCode, isValidVpa, validateGstin } from "@/lib/india";

const decimalString = (maxDp = 2) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,9}(\\.\\d{1,${maxDp}})?$`), "Enter a valid number");

const percentString = decimalString(2).refine((v) => Number(v) <= 100, "Must be 100 or less");

/**
 * Google Maps "Embed a map" address. Staff can paste either the address or the whole <iframe> snippet Google
 * gives them; only a https://www.google.com/maps/embed address is accepted, because it ends up in an iframe on
 * the public site (the site's security policy allows frames from that address and nowhere else).
 */
export const MAP_EMBED_PATTERN = /^https:\/\/www\.google\.com\/maps\/embed\?pb=[^\s"'<>]{10,1500}$/;
export function mapEmbedFromInput(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const text = v.trim();
  const fromSnippet = /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i.exec(text);
  return (fromSnippet ? fromSnippet[1] : text).replace(/&amp;/g, "&").trim();
}
const mapEmbedUrl = z.preprocess(
  mapEmbedFromInput,
  z.string().max(1600).refine((v) => v === "" || MAP_EMBED_PATTERN.test(v), "Paste the link from Google Maps → Share → Embed a map (it starts with https://www.google.com/maps/embed?pb=)"),
);

export const businessSchema = z.object({
  name: z.string().trim().min(2).max(80),
  tagline: z.string().trim().max(120),
  addressLine1: z.string().trim().min(3).max(120),
  addressLine2: z.string().trim().max(120),
  city: z.string().trim().min(2).max(60),
  district: z.string().trim().max(60),
  stateCode: z.string().refine(isValidStateCode, "Unknown state code"),
  pincode: z.string().regex(/^[1-9][0-9]{5}$/, "6-digit PIN code"),
  phone: z.string().trim().max(20),
  whatsapp: z.string().trim().max(20),
  email: z.string().trim().max(120),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || validateGstin(v).ok, "Invalid GSTIN"),
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => v === "" || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v), "Invalid PAN"),
  about: z.string().trim().max(2000),
  openingHours: z.string().trim().max(200),
  mapUrl: z.string().trim().max(500),
  /** The map shown on the website (empty: no map, just the link). */
  mapEmbedUrl: mapEmbedUrl,
});

export const taxSchema = z
  .object({
    /**
     * null = not yet confirmed. Real billing documents cannot be issued until the
     * Super Admin confirms the GST registration type (with the accountant).
     */
    registrationType: z.enum(["regular", "composition", "unregistered"]).nullable(),
    pricesIncludeTaxByDefault: z.boolean(),
    roundOff: z.enum(["none", "nearest_rupee"]),
    /** Minimum HSN digits required on tax invoices (Notification 78/2020: 4 up to ₹5 cr turnover, else 6). */
    hsnMinDigits: z.union([z.literal(4), z.literal(6), z.literal(8)]),
    /** Rule 46(e): recipient name, address & state mandatory for unregistered buyers at/above this taxable value. */
    b2cDetailsThreshold: decimalString(2),
    confirmedBy: z.string().max(120),
    confirmedNote: z.string().max(500),
  })
  .strict();

export const documentsSchema = z.object({
  prefixes: z.object({
    tax_invoice: z.string().regex(DOC_PREFIX_RE, "1–4 capital letters/digits"),
    bill_of_supply: z.string().regex(DOC_PREFIX_RE, "1–4 capital letters/digits"),
    cash_memo: z.string().regex(DOC_PREFIX_RE, "1–4 capital letters/digits"),
    credit_note: z.string().regex(DOC_PREFIX_RE, "1–4 capital letters/digits"),
    quotation: z.string().regex(DOC_PREFIX_RE, "1–4 capital letters/digits"),
    training: z.string().regex(DOC_PREFIX_RE, "1–4 capital letters/digits"),
  }),
  quotationValidityDays: z.number().int().min(1).max(90),
  terms: z.array(z.string().trim().max(300)).max(10),
  signatoryLabel: z.string().trim().max(120),
  footerNote: z.string().trim().max(200),
  bankDetails: z.string().trim().max(500),
  shareLinksEnabled: z.boolean(),
});

export const paymentsSchema = z
  .object({
    upiEnabled: z.boolean(),
    upiVpa: z.string().trim(),
    upiPayeeName: z.string().trim().max(50),
    /** Only set when the UPI ID is a verified merchant with this MCC. Leave blank otherwise. */
    upiMerchantCode: z.string().trim().regex(/^(\d{4})?$/, "4-digit MCC or blank"),
    qrExpiryMinutes: z.number().int().min(2).max(120),
    /** Most UPI P2M payments are limited to ₹1,00,000 each; split larger bills. */
    maxPerUpiPayment: decimalString(2),
    requireUpiReference: z.boolean(),
    cashEnabled: z.boolean(),
    cardEnabled: z.boolean(),
    bankTransferEnabled: z.boolean(),
    chequeEnabled: z.boolean(),
    gatewayProvider: z.enum(["none", "razorpay"]),
  })
  .refine((v) => !v.upiEnabled || isValidVpa(v.upiVpa), {
    message: "A valid UPI ID (e.g. shopname@bank) is required to enable UPI QR",
    path: ["upiVpa"],
  });

export const discountsSchema = z.object({
  /** Global minimum gross margin % (category/variant overrides win). Blank = no floor. */
  minMarginPercent: z.union([percentString, z.literal("")]),
  /** Global target gross margin % used for price suggestions. Blank = none. */
  targetMarginPercent: z.union([percentString, z.literal("")]),
  requireReasonForAnyDiscount: z.boolean(),
  allowCreditSales: z.boolean(),
  inPersonApprovalEnabled: z.boolean(),
});

export const pricingSchema = z.object({
  /** When true, price changes by users without prices.approve stay pending until approved. */
  priceChangeRequiresApproval: z.boolean(),
  /** Flag products whose price hasn't been reviewed in this many days. */
  reviewAfterDays: z.number().int().min(7).max(3650),
});

export const securitySchema = z.object({
  sessionIdleMinutes: z.number().int().min(10).max(24 * 60),
  sessionMaxHours: z.number().int().min(1).max(24 * 30),
  maxFailedLogins: z.number().int().min(3).max(20),
  lockoutMinutes: z.number().int().min(1).max(24 * 60),
  minPasswordLength: z.number().int().min(10).max(64),
});

export const websiteSchema = z.object({
  showPrices: z.boolean(),
  priceNote: z.string().trim().max(300),
  enquiriesEnabled: z.boolean(),
  /** Customers must enter a code emailed to them to create an account and before paying (only while email sending is set up). */
  requireEmailVerification: z.boolean(),
  heroTitle: z.string().trim().max(120),
  heroSubtitle: z.string().trim().max(300),
});

export const inventorySchema = z.object({
  enabled: z.boolean(),
  deductStockOnSale: z.boolean(),
});

/** What the owner is sent by email: the evening summary and a note when staff ask for approval. */
export const alertsSchema = z.object({
  ownerEmail: z
    .string()
    .trim()
    .max(120)
    .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address"),
  dailySummary: z.boolean(),
  approvalAlerts: z.boolean(),
});

export const SETTINGS_SCHEMAS = {
  business: businessSchema,
  tax: taxSchema,
  documents: documentsSchema,
  payments: paymentsSchema,
  discounts: discountsSchema,
  pricing: pricingSchema,
  security: securitySchema,
  website: websiteSchema,
  inventory: inventorySchema,
  alerts: alertsSchema,
} as const;

export type SettingsSection = keyof typeof SETTINGS_SCHEMAS;
export type Settings = { [K in SettingsSection]: z.infer<(typeof SETTINGS_SCHEMAS)[K]> };

export const SETTINGS_DEFAULTS: Settings = {
  business: {
    name: "OM ENTERPRISE",
    tagline: "Your Complete Building Solution",
    addressLine1: "Nr. Shivani Showroom, Bodeli Road",
    addressLine2: "",
    city: "Naswadi",
    district: "Chhota Udaipur",
    stateCode: "24",
    pincode: "391150",
    phone: "7621934414",
    whatsapp: "7621934414",
    email: "omenterprise1119@gmail.com",
    gstin: "24CSLPM5670H1ZF",
    pan: "",
    about:
      "OM ENTERPRISE supplies building materials for homes, shops and construction projects in and around Naswadi — paints, water tanks, bathware and sanitary fittings, CPVC, PVC, UPVC and SWR pipes and fittings, plumbing accessories and more, all under one roof.",
    openingHours: "",
    mapUrl: "",
    mapEmbedUrl:
      "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d1345.8967304064693!2d73.71626511345866!3d22.03432422099073!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x396005527fd4b703%3A0x13060d2fe5096d41!2sOm%20enterprise!5e0!3m2!1sen!2sin!4v1794028366375!5m2!1sen!2sin",
  },
  tax: {
    registrationType: null,
    pricesIncludeTaxByDefault: true,
    roundOff: "nearest_rupee",
    hsnMinDigits: 4,
    b2cDetailsThreshold: "50000",
    confirmedBy: "",
    confirmedNote: "",
  },
  documents: {
    prefixes: {
      tax_invoice: "OE",
      bill_of_supply: "BS",
      cash_memo: "CM",
      credit_note: "CN",
      quotation: "QT",
      training: "TRN",
    },
    quotationValidityDays: 7,
    terms: [],
    signatoryLabel: "For OM ENTERPRISE — Authorised Signatory",
    footerNote: "Thank you for your business!",
    bankDetails: "",
    shareLinksEnabled: true,
  },
  payments: {
    upiEnabled: false,
    upiVpa: "",
    upiPayeeName: "OM ENTERPRISE",
    upiMerchantCode: "",
    qrExpiryMinutes: 15,
    maxPerUpiPayment: "100000",
    requireUpiReference: true,
    cashEnabled: true,
    cardEnabled: false,
    bankTransferEnabled: true,
    chequeEnabled: false,
    gatewayProvider: "none",
  },
  discounts: {
    minMarginPercent: "",
    targetMarginPercent: "",
    requireReasonForAnyDiscount: false,
    allowCreditSales: false,
    inPersonApprovalEnabled: true,
  },
  pricing: {
    priceChangeRequiresApproval: true,
    reviewAfterDays: 180,
  },
  security: {
    sessionIdleMinutes: 480,
    sessionMaxHours: 24,
    maxFailedLogins: 5,
    lockoutMinutes: 15,
    minPasswordLength: 10,
  },
  website: {
    showPrices: true,
    requireEmailVerification: true,
    priceNote:
      "Prices shown are our current selling prices (inclusive of GST where applicable) and are confirmed at billing.",
    enquiriesEnabled: true,
    heroTitle: "Everything you need to build, in one place.",
    heroSubtitle:
      "Paints, water tanks, bathware, CPVC / PVC / UPVC / SWR pipes & fittings and plumbing essentials in Naswadi. Prices are listed online; we confirm stock on WhatsApp.",
  },
  inventory: {
    enabled: false,
    deductStockOnSale: false,
  },
  alerts: {
    ownerEmail: "",
    dailySummary: true,
    approvalAlerts: true,
  },
};

/** Which permission is required to edit each section. "super_admin" = Super Admin only. */
export const SETTINGS_EDIT_PERMISSION: Record<SettingsSection, string> = {
  business: "settings.business",
  tax: "settings.tax",
  documents: "settings.documents",
  payments: "settings.payment",
  discounts: "discounts.configure",
  pricing: "discounts.configure",
  security: "super_admin",
  website: "settings.business",
  inventory: "super_admin",
  alerts: "super_admin",
};

export function parseSection<K extends SettingsSection>(section: K, stored: unknown): Settings[K] {
  const base = SETTINGS_DEFAULTS[section] as Record<string, unknown>;
  const merged = { ...base, ...((stored as Record<string, unknown>) ?? {}) };
  const res = SETTINGS_SCHEMAS[section].safeParse(merged);
  // Stored values that no longer validate fall back to defaults rather than breaking the app.
  return (res.success ? res.data : SETTINGS_DEFAULTS[section]) as Settings[K];
}
