/**
 * OM Enterprise — database schema.
 *
 * Conventions
 * - Money: numeric(14,2) (rupees, 2dp). Unit costs: numeric(14,4). Quantities: numeric(14,3).
 *   node-postgres returns numerics as strings; convert with `D()` from `@/lib/money`.
 * - Status columns are text with CHECK constraints (easier to evolve than enums).
 * - Financial records (sales once finalized, payments, documents, audit logs, price/cost
 *   versions) are protected by triggers in drizzle/0002_integrity.sql. Never rely on app
 *   code alone to keep history intact.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const cost = (name: string) => numeric(name, { precision: 14, scale: 4 });
const qty = (name: string) => numeric(name, { precision: 14, scale: 3 });
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const rate = (name: string) => numeric(name, { precision: 6, scale: 3 });
const pct = (name: string) => numeric(name, { precision: 5, scale: 2 });

/* ------------------------------------------------------------------ */
/* Identity, access control, sessions                                  */
/* ------------------------------------------------------------------ */

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  /** Default max discount % a member may apply without approval. */
  defaultDiscountLimitPercent: pct("default_discount_limit_percent").notNull().default("0"),
  /** Default max discount % a member may approve for others. */
  defaultApprovalLimitPercent: pct("default_approval_limit_percent").notNull().default("0"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permission] })],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    mobile: text("mobile"),
    email: text("email"),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    isActive: boolean("is_active").notNull().default(true),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    /** Overrides role default when not null. */
    discountLimitPercent: pct("discount_limit_percent"),
    approvalLimitPercent: pct("approval_limit_percent"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    passwordChangedAt: ts("password_changed_at"),
    /** Optional second sign-in step: scrypt hash of the user's secret key (null = not set). */
    loginSecretHash: text("login_secret_hash"),
    loginSecretSetAt: ts("login_secret_set_at"),
    /** Counter staff only: scrypt hash of a 4–6 digit PIN to sign in with instead of the password (null = none). */
    pinHash: text("pin_hash"),
    pinSetAt: ts("pin_set_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_username_lower_uq").on(sql`lower(${t.username})`),
    check("users_username_format", sql`${t.username} ~ '^[A-Za-z0-9._-]{3,40}$'`),
  ],
);

export const userPermissionOverrides = pgTable(
  "user_permission_overrides",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    effect: text("effect").$type<"grant" | "deny">().notNull(),
    grantedBy: uuid("granted_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.permission] }),
    check("upo_effect", sql`${t.effect} in ('grant','deny')`),
  ],
);

/**
 * Sign-in that passed the password step and now waits for the secret key. Short-lived, single use,
 * limited attempts. Only sha256(token) is stored.
 */
export const loginChallenges = pgTable(
  "login_challenges",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    ip: text("ip"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("login_challenges_user_idx").on(t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256(token) hex — the raw token only ever lives in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    /** Snapshot of the actor's name/role at the time ("Sachin (Sales & Operations)", "system", "public"); older rows carry the role key. */
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    data: jsonb("data"),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [
    index("audit_at_idx").on(t.at),
    index("audit_entity_idx").on(t.entityType, t.entityId),
    index("audit_actor_idx").on(t.actorUserId),
    index("audit_action_idx").on(t.action),
  ],
);

export const settings = pgTable("settings", {
  section: text("section").primaryKey(),
  value: jsonb("value").notNull(),
  version: integer("version").notNull().default(1),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  storageKey: text("storage_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  purpose: text("purpose").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** File bytes when UPLOAD_STORAGE=database (hosts without a persistent disk, e.g. Vercel). */
export const uploadObjects = pgTable("upload_objects", {
  storageKey: text("storage_key").primaryKey(),
  data: bytea("data").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

export const units = pgTable("units", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** GST Unique Quantity Code used in returns / HSN summary (PCS, LTR, MTR, KGS, BOX, SET, ROL, PAC, OTH…). */
  uqc: text("uqc").notNull().default("OTH"),
  /** Max decimal places allowed for quantities in this unit (0 = whole units only). */
  decimals: integer("decimals").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

export const taxClasses = pgTable(
  "tax_classes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    /** Total GST rate in percent (CGST+SGST or IGST). 0 for exempt / nil-rated. */
    gstRate: rate("gst_rate").notNull(),
    cessRate: rate("cess_rate").notNull().default("0"),
    isExempt: boolean("is_exempt").notNull().default(false),
    description: text("description"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("tax_rate_range", sql`${t.gstRate} >= 0 and ${t.gstRate} <= 100 and ${t.cessRate} >= 0`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    description: text("description"),
    icon: text("icon"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    isPublished: boolean("is_published").notNull().default(true),
    targetMarginPercent: pct("target_margin_percent"),
    minMarginPercent: pct("min_margin_percent"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("categories_parent_idx").on(t.parentId)],
);

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
  manufacturer: text("manufacturer"),
  description: text("description"),
  website: text("website"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type SpecRow = { label: string; value: string };

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    brandId: uuid("brand_id").references(() => brands.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    manufacturer: text("manufacturer"),
    model: text("model"),
    description: text("description"),
    specifications: jsonb("specifications").$type<SpecRow[]>().notNull().default([]),
    /** Attribute names that distinguish variants, e.g. ["Colour", "Pack size"]. */
    variantAttributes: jsonb("variant_attributes").$type<string[]>().notNull().default([]),
    warrantyInfo: text("warranty_info"),
    hsnCode: text("hsn_code"),
    taxClassId: uuid("tax_class_id").references(() => taxClasses.id),
    unitCode: text("unit_code")
      .notNull()
      .references(() => units.code),
    discountEligible: boolean("discount_eligible").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    isPublished: boolean("is_published").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),
    /** Demonstration product — never a real business record. */
    isSample: boolean("is_sample").notNull().default(false),
    reviewStatus: text("review_status")
      .$type<"draft" | "pending_review" | "approved">()
      .notNull()
      .default("draft"),
    /** Where the data came from (catalogue page, data sheet, supplier quote…). */
    sourceInfo: text("source_info"),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    index("products_category_idx").on(t.categoryId),
    index("products_brand_idx").on(t.brandId),
    index("products_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    check("products_review_status", sql`${t.reviewStatus} in ('draft','pending_review','approved')`),
    check("products_hsn_format", sql`${t.hsnCode} is null or ${t.hsnCode} ~ '^[0-9]{4,8}$'`),
  ],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    name: text("name").notNull(),
    attributes: jsonb("attributes").$type<Record<string, string>>().notNull().default({}),
    unitCode: text("unit_code")
      .notNull()
      .references(() => units.code),
    /** Null = inherit from product. */
    taxClassId: uuid("tax_class_id").references(() => taxClasses.id),
    discountEligible: boolean("discount_eligible"),
    targetMarginPercent: pct("target_margin_percent"),
    minMarginPercent: pct("min_margin_percent"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    reorderLevel: qty("reorder_level"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("variants_sku_uq").on(sql`upper(${t.sku})`),
    uniqueIndex("variants_barcode_uq").on(t.barcode).where(sql`${t.barcode} is not null`),
    index("variants_product_idx").on(t.productId),
    index("variants_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    check("variants_sku_format", sql`${t.sku} ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{1,39}$'`),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "cascade" }),
    uploadId: uuid("upload_id").references(() => uploads.id),
    url: text("url").notNull(),
    alt: text("alt"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

/** Explicitly configured alternate selling units. No implicit conversions exist. */
export const variantUnitConversions = pgTable(
  "variant_unit_conversions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    unitCode: text("unit_code")
      .notNull()
      .references(() => units.code),
    /** How many base units one of this unit represents (e.g. 1 box = 10 pcs → 10). */
    factor: numeric("factor", { precision: 14, scale: 6 }).notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("vuc_variant_unit_uq").on(t.variantId, t.unitCode),
    check("vuc_factor_positive", sql`${t.factor} > 0`),
  ],
);

/** Explicit compatibility (e.g. a fitting with a pipe). Stored once with variant_a < variant_b. */
export const variantCompatibility = pgTable(
  "variant_compatibility",
  {
    variantA: uuid("variant_a")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    variantB: uuid("variant_b")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.variantA, t.variantB] }),
    check("compat_ordered", sql`${t.variantA} < ${t.variantB}`),
  ],
);

/* ------------------------------------------------------------------ */
/* Pricing & cost                                                      */
/* ------------------------------------------------------------------ */

export const priceLists = pgTable("price_lists", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isPublic: boolean("is_public").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type PriceTier = { minQty: string; price: string };

/**
 * Every row is one immutable price version. The active price for (variant, list) at time T
 * is the approved row with the greatest effective_from <= T.
 */
export const variantPrices = pgTable(
  "variant_prices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id),
    price: money("price").notNull(),
    priceIncludesTax: boolean("price_includes_tax").notNull(),
    mrp: money("mrp"),
    /** Quantity breaks: [{minQty:"10", price:"95.00"}] — same tax basis as `price`. */
    tiers: jsonb("tiers").$type<PriceTier[]>().notNull().default([]),
    effectiveFrom: ts("effective_from").notNull(),
    status: text("status")
      .$type<"pending" | "approved" | "rejected" | "cancelled">()
      .notNull(),
    reason: text("reason").notNull(),
    previousVersionId: uuid("previous_version_id"),
    previousPrice: money("previous_price"),
    /** Landed cost & margin at the time of the change (for review; null when cost unknown). */
    landedCostSnapshot: cost("landed_cost_snapshot"),
    marginPercentSnapshot: numeric("margin_percent_snapshot", { precision: 8, scale: 2 }),
    previousMarginPercent: numeric("previous_margin_percent", { precision: 8, scale: 2 }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    /** The bulk import that brought this price in (one id per import), so its prices can be reviewed together. */
    importBatchId: uuid("import_batch_id"),
  },
  (t) => [
    index("variant_prices_lookup_idx").on(t.variantId, t.priceListId, t.status, t.effectiveFrom),
    index("variant_prices_import_batch_idx").on(t.importBatchId).where(sql`${t.importBatchId} is not null`),
    check("vp_status", sql`${t.status} in ('pending','approved','rejected','cancelled')`),
    check("vp_price_nonneg", sql`${t.price} >= 0 and (${t.mrp} is null or ${t.mrp} >= 0)`),
  ],
);

/** Immutable cost versions. Landed cost is computed at entry using the ITC policy in force. */
export const variantCosts = pgTable(
  "variant_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    purchaseCost: cost("purchase_cost").notNull(),
    purchaseTaxRate: rate("purchase_tax_rate").notNull().default("0"),
    freight: cost("freight").notNull().default("0"),
    handling: cost("handling").notNull().default("0"),
    otherCosts: cost("other_costs").notNull().default("0"),
    itcPolicy: text("itc_policy").$type<"recoverable" | "non_recoverable">().notNull(),
    landedCost: cost("landed_cost").notNull(),
    effectiveFrom: ts("effective_from").notNull(),
    supplierId: uuid("supplier_id"),
    sourceRef: text("source_ref"),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("variant_costs_lookup_idx").on(t.variantId, t.effectiveFrom),
    check("vc_itc", sql`${t.itcPolicy} in ('recoverable','non_recoverable')`),
    check(
      "vc_nonneg",
      sql`${t.purchaseCost} >= 0 and ${t.freight} >= 0 and ${t.handling} >= 0 and ${t.otherCosts} >= 0 and ${t.landedCost} >= 0`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Suppliers & inventory (data model ready; workflow disabled by default) */
/* ------------------------------------------------------------------ */

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  gstin: text("gstin"),
  mobile: text("mobile"),
  email: text("email"),
  address: text("address"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id),
});

export const variantSuppliers = pgTable(
  "variant_suppliers",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    supplierSku: text("supplier_sku"),
    isPreferred: boolean("is_preferred").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.variantId, t.supplierId] })],
);

export const stockLocations = pgTable("stock_locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  address: text("address"),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
});

export const purchaseReceipts = pgTable("purchase_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => suppliers.id),
  locationId: uuid("location_id")
    .notNull()
    .references(() => stockLocations.id),
  supplierBillNo: text("supplier_bill_no"),
  billDate: ts("bill_date"),
  status: text("status").$type<"draft" | "received" | "cancelled">().notNull().default("draft"),
  totalAmount: money("total_amount").notNull().default("0"),
  notes: text("notes"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
  receivedAt: ts("received_at"),
});

export const purchaseReceiptLines = pgTable("purchase_receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id")
    .notNull()
    .references(() => purchaseReceipts.id),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  quantity: qty("quantity").notNull(),
  unitCost: cost("unit_cost").notNull(),
  taxRate: rate("tax_rate").notNull().default("0"),
});

/** Append-only stock ledger. On-hand = SUM(quantity_change). Not written by sales until enabled. */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => stockLocations.id),
    quantityChange: qty("quantity_change").notNull(),
    movementType: text("movement_type")
      .$type<
        | "opening"
        | "purchase_receipt"
        | "sale"
        | "customer_return"
        | "supplier_return"
        | "damage"
        | "adjustment"
        | "transfer_in"
        | "transfer_out"
      >()
      .notNull(),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    unitCost: cost("unit_cost"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stock_mov_variant_idx").on(t.variantId, t.locationId),
    check(
      "stock_mov_type",
      sql`${t.movementType} in ('opening','purchase_receipt','sale','customer_return','supplier_return','damage','adjustment','transfer_in','transfer_out')`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Customers                                                           */
/* ------------------------------------------------------------------ */

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    mobile: text("mobile"),
    /** The number bills go to on WhatsApp: the mobile, another number, or null for none. */
    whatsapp: text("whatsapp"),
    email: text("email"),
    businessName: text("business_name"),
    gstin: text("gstin"),
    billingAddress: text("billing_address"),
    city: text("city"),
    stateCode: text("state_code"),
    pincode: text("pincode"),
    customerType: text("customer_type")
      .$type<"retail" | "contractor" | "business">()
      .notNull()
      .default("retail"),
    notes: text("notes"),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("customers_mobile_idx").on(t.mobile),
    index("customers_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
    check("customers_type", sql`${t.customerType} in ('retail','contractor','business')`),
  ],
);

/* ------------------------------------------------------------------ */
/* Sales                                                               */
/* ------------------------------------------------------------------ */

export type SaleStatus = "draft" | "finalized" | "completed" | "cancelled";
export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "partially_refunded" | "refunded";
export type ApprovalStatus = "not_required" | "required" | "pending" | "approved" | "rejected";

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleNumber: text("sale_number").notNull().unique(),
    status: text("status").$type<SaleStatus>().notNull().default("draft"),
    paymentStatus: text("payment_status").$type<PaymentStatus>().notNull().default("unpaid"),
    approvalStatus: text("approval_status").$type<ApprovalStatus>().notNull().default("not_required"),
    /** Training sales contain sample products; documents are watermarked and excluded from reports. */
    isTraining: boolean("is_training").notNull().default(false),
    source: text("source").$type<"pos" | "website_order">().notNull().default("pos"),
    websiteOrderId: uuid("website_order_id"),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id),
    customerId: uuid("customer_id").references(() => customers.id),
    /** Tax regime frozen at finalisation: intra (CGST+SGST), inter (IGST) or none (not charged). */
    taxMode: text("tax_mode").$type<"intra" | "inter" | "none">().notNull().default("intra"),
    placeOfSupplyStateCode: text("place_of_supply_state_code").notNull(),
    cartDiscountType: text("cart_discount_type").$type<"percent" | "amount">(),
    cartDiscountValue: money("cart_discount_value"),
    cartDiscountReason: text("cart_discount_reason"),
    roundOffMode: text("round_off_mode").$type<"none" | "nearest_rupee">().notNull().default("nearest_rupee"),
    // Totals (recomputed while draft; frozen once finalised)
    listTotal: money("list_total").notNull().default("0"),
    subtotalGross: money("subtotal_gross").notNull().default("0"),
    lineDiscountTotal: money("line_discount_total").notNull().default("0"),
    cartDiscountTotal: money("cart_discount_total").notNull().default("0"),
    taxableTotal: money("taxable_total").notNull().default("0"),
    cgstTotal: money("cgst_total").notNull().default("0"),
    sgstTotal: money("sgst_total").notNull().default("0"),
    igstTotal: money("igst_total").notNull().default("0"),
    cessTotal: money("cess_total").notNull().default("0"),
    chargesTotal: money("charges_total").notNull().default("0"),
    roundOff: money("round_off").notNull().default("0"),
    grandTotal: money("grand_total").notNull().default("0"),
    effectiveDiscountPercent: pct("effective_discount_percent").notNull().default("0"),
    costKnown: boolean("cost_known").notNull().default(false),
    costTotal: money("cost_total"),
    grossProfit: money("gross_profit"),
    amountPaid: money("amount_paid").notNull().default("0"),
    amountRefunded: money("amount_refunded").notNull().default("0"),
    /** sha256 over the pricing-relevant cart contents; approvals bind to it. */
    cartFingerprint: text("cart_fingerprint"),
    /** The approval that authorised the finalised discount (if one was needed). */
    approvalRequestId: uuid("approval_request_id"),
    quotationDocumentId: uuid("quotation_document_id"),
    quotationValidUntil: ts("quotation_valid_until"),
    notes: text("notes"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    finalizedAt: ts("finalized_at"),
    finalizedBy: uuid("finalized_by").references(() => users.id),
    completedAt: ts("completed_at"),
    cancelledAt: ts("cancelled_at"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    /** Deleted by the Super Admin: hidden from every list and report, kept for the audit trail; never changes again. */
    deletedAt: ts("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => users.id),
    deleteReason: text("delete_reason"),
  },
  (t) => [
    index("sales_status_idx").on(t.status, t.createdAt),
    index("sales_created_by_idx").on(t.createdBy, t.createdAt),
    index("sales_customer_idx").on(t.customerId),
    check("sales_status", sql`${t.status} in ('draft','finalized','completed','cancelled')`),
    check(
      "sales_payment_status",
      sql`${t.paymentStatus} in ('unpaid','partially_paid','paid','partially_refunded','refunded')`,
    ),
    check(
      "sales_approval_status",
      sql`${t.approvalStatus} in ('not_required','required','pending','approved','rejected')`,
    ),
    check("sales_tax_mode", sql`${t.taxMode} in ('intra','inter','none')`),
    check("sales_source", sql`${t.source} in ('pos','website_order')`),
    check("sales_amounts_nonneg", sql`${t.grandTotal} >= 0 and ${t.amountPaid} >= 0 and ${t.amountRefunded} >= 0`),
  ],
);

export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    lineNo: integer("line_no").notNull(),
    lineType: text("line_type").$type<"item" | "charge">().notNull().default("item"),
    variantId: uuid("variant_id").references(() => productVariants.id),
    // Descriptive snapshot (frozen at finalisation)
    sku: text("sku"),
    productName: text("product_name").notNull(),
    variantName: text("variant_name"),
    brandName: text("brand_name"),
    hsnCode: text("hsn_code"),
    unitCode: text("unit_code").notNull(),
    isSample: boolean("is_sample").notNull().default(false),
    quantity: qty("quantity").notNull(),
    // Price snapshot
    priceListUnitPrice: money("price_list_unit_price").notNull(),
    unitPrice: money("unit_price").notNull(),
    priceIncludesTax: boolean("price_includes_tax").notNull(),
    priceVersionId: uuid("price_version_id"),
    priceSource: text("price_source")
      .$type<"price_list" | "quantity_tier" | "quotation" | "override" | "manual_charge">()
      .notNull(),
    overrideReason: text("override_reason"),
    discountEligible: boolean("discount_eligible").notNull().default(true),
    lineDiscountType: text("line_discount_type").$type<"percent" | "amount">(),
    lineDiscountValue: money("line_discount_value"),
    lineDiscountReason: text("line_discount_reason"),
    // Computed values
    grossAmount: money("gross_amount").notNull(),
    lineDiscountAmount: money("line_discount_amount").notNull().default("0"),
    cartDiscountShare: money("cart_discount_share").notNull().default("0"),
    netAmount: money("net_amount").notNull(),
    gstRate: rate("gst_rate").notNull(),
    cessRate: rate("cess_rate").notNull().default("0"),
    taxableValue: money("taxable_value").notNull(),
    cgstAmount: money("cgst_amount").notNull().default("0"),
    sgstAmount: money("sgst_amount").notNull().default("0"),
    igstAmount: money("igst_amount").notNull().default("0"),
    cessAmount: money("cess_amount").notNull().default("0"),
    lineTotal: money("line_total").notNull(),
    // Cost snapshot (null when unknown → profit not computed)
    unitCost: cost("unit_cost"),
    costVersionId: uuid("cost_version_id"),
    costTotal: money("cost_total"),
    grossProfit: money("gross_profit"),
    belowCost: boolean("below_cost").notNull().default(false),
    belowMarginFloor: boolean("below_margin_floor").notNull().default(false),
    addedBy: uuid("added_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sale_lines_no_uq").on(t.saleId, t.lineNo),
    index("sale_lines_variant_idx").on(t.variantId),
    check("sale_lines_type", sql`${t.lineType} in ('item','charge')`),
    check("sale_lines_qty_positive", sql`${t.quantity} > 0`),
    check("sale_lines_item_has_variant", sql`${t.lineType} = 'charge' or ${t.variantId} is not null`),
    check(
      "sale_lines_price_source",
      sql`${t.priceSource} in ('price_list','quantity_tier','quotation','override','manual_charge')`,
    ),
  ],
);

export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").$type<"sale_discount" | "price_change">().notNull(),
    saleId: uuid("sale_id").references(() => sales.id),
    priceVersionId: uuid("price_version_id").references(() => variantPrices.id),
    cartFingerprint: text("cart_fingerprint"),
    /** Requested discount % / below-cost flags, etc. */
    details: jsonb("details").notNull(),
    reason: text("reason").notNull(),
    status: text("status")
      .$type<"pending" | "approved" | "rejected" | "cancelled" | "superseded">()
      .notNull()
      .default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    /** 'remote' (approvals queue) or 'in_person' (approver entered credentials at the counter). */
    decisionChannel: text("decision_channel"),
  },
  (t) => [
    index("approvals_status_idx").on(t.status, t.requestedAt),
    index("approvals_sale_idx").on(t.saleId),
    check("approvals_type", sql`${t.type} in ('sale_discount','price_change')`),
    check(
      "approvals_status",
      sql`${t.status} in ('pending','approved','rejected','cancelled','superseded')`,
    ),
  ],
);

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export type PaymentRecordStatus =
  | "pending"
  | "initiated"
  | "successful"
  | "failed"
  | "expired"
  | "cancelled"
  | "reversed";

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    direction: text("direction").$type<"in" | "refund">().notNull().default("in"),
    method: text("method")
      .$type<"upi" | "cash" | "card" | "bank_transfer" | "cheque" | "other">()
      .notNull(),
    provider: text("provider").notNull(),
    amount: money("amount").notNull(),
    status: text("status").$type<PaymentRecordStatus>().notNull(),
    /** UTR / UPI ref / cheque no. / gateway payment id as shown to the operator. */
    reference: text("reference"),
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    qrPayload: text("qr_payload"),
    expiresAt: ts("expires_at"),
    tenderedAmount: money("tendered_amount"),
    verificationMethod: text("verification_method").$type<
      | "manual_merchant_app"
      | "manual_bank_statement"
      | "cash_counted"
      | "gateway_webhook"
      | "gateway_api"
      | "manual_other"
    >(),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: ts("verified_at"),
    verificationNote: text("verification_note"),
    receivedAt: ts("received_at"),
    failureReason: text("failure_reason"),
    refundOfPaymentId: uuid("refund_of_payment_id"),
    creditNoteDocumentId: uuid("credit_note_document_id"),
    reversedBy: uuid("reversed_by").references(() => users.id),
    reversedAt: ts("reversed_at"),
    reversalReason: text("reversal_reason"),
    providerData: jsonb("provider_data"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("payments_sale_idx").on(t.saleId),
    index("payments_status_idx").on(t.status, t.createdAt),
    uniqueIndex("payments_provider_payment_uq")
      .on(t.provider, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} is not null`),
    // The same UTR/reference cannot confirm two incoming payments. UPI and bank transfers share one
    // namespace because both carry bank UTRs; card codes and cheque numbers are only unique per method.
    uniqueIndex("payments_reference_uq")
      .on(sql`(case when ${t.method} in ('upi','bank_transfer') then 'bank' else ${t.method} end)`, sql`upper(${t.reference})`)
      .where(sql`${t.reference} is not null and ${t.direction} = 'in' and ${t.status} = 'successful'`),
    check("payments_direction", sql`${t.direction} in ('in','refund')`),
    check("payments_method", sql`${t.method} in ('upi','cash','card','bank_transfer','cheque','other')`),
    check(
      "payments_status",
      sql`${t.status} in ('pending','initiated','successful','failed','expired','cancelled','reversed')`,
    ),
    check("payments_amount_positive", sql`${t.amount} > 0`),
    check(
      "payments_success_verified",
      sql`${t.status} <> 'successful' or (${t.verificationMethod} is not null and ${t.verifiedAt} is not null)`,
    ),
  ],
);

/** Webhook inbox: one row per provider event id → idempotent processing. */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    signatureValid: boolean("signature_valid").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    result: text("result"),
    paymentId: uuid("payment_id"),
  },
  (t) => [uniqueIndex("payment_events_uq").on(t.provider, t.eventId)],
);

/* ------------------------------------------------------------------ */
/* Documents (quotations, invoices, bills of supply, credit notes)      */
/* ------------------------------------------------------------------ */

export type DocType =
  | "quotation"
  | "tax_invoice"
  | "bill_of_supply"
  | "cash_memo"
  | "credit_note";

export const documentSequences = pgTable(
  "document_sequences",
  {
    seriesKey: text("series_key").notNull(),
    financialYear: text("financial_year").notNull(),
    nextSeq: integer("next_seq").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.seriesKey, t.financialYear] })],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    docType: text("doc_type").$type<DocType>().notNull(),
    seriesKey: text("series_key").notNull(),
    financialYear: text("financial_year").notNull(),
    seq: integer("seq").notNull(),
    docNumber: text("doc_number").notNull().unique(),
    isTraining: boolean("is_training").notNull().default(false),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => users.id),
    status: text("status").$type<"issued" | "cancelled">().notNull().default("issued"),
    /** Full rendered data: seller, buyer, lines, tax summary, totals, payments, declarations. */
    snapshot: jsonb("snapshot").notNull(),
    taxableTotal: money("taxable_total").notNull(),
    taxTotal: money("tax_total").notNull(),
    grandTotal: money("grand_total").notNull(),
    originalDocumentId: uuid("original_document_id"),
    validUntil: ts("valid_until"),
    cancelledAt: ts("cancelled_at"),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
    cancelReason: text("cancel_reason"),
    /** A quotation deleted by the Super Admin (or any document of a deleted sale): hidden, kept for the audit trail. */
    deletedAt: ts("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => users.id),
    deleteReason: text("delete_reason"),
    shareToken: text("share_token").unique(),
    printCount: integer("print_count").notNull().default(0),
    lastPrintedAt: ts("last_printed_at"),
  },
  (t) => [
    uniqueIndex("documents_series_seq_uq").on(t.seriesKey, t.financialYear, t.seq),
    index("documents_sale_idx").on(t.saleId),
    index("documents_issued_idx").on(t.docType, t.issuedAt),
    check(
      "documents_type",
      sql`${t.docType} in ('quotation','tax_invoice','bill_of_supply','cash_memo','credit_note')`,
    ),
    check("documents_status", sql`${t.status} in ('issued','cancelled')`),
    check("documents_number_len", sql`char_length(${t.docNumber}) <= 16 and ${t.docNumber} ~ '^[A-Za-z0-9/-]+$'`),
  ],
);

export const saleReturns = pgTable(
  "sale_returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    creditNoteDocumentId: uuid("credit_note_document_id")
      .notNull()
      .references(() => documents.id),
    reason: text("reason").notNull(),
    taxableTotal: money("taxable_total").notNull(),
    taxTotal: money("tax_total").notNull(),
    grandTotal: money("grand_total").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sale_returns_sale_idx").on(t.saleId)],
);

export const saleReturnLines = pgTable("sale_return_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  returnId: uuid("return_id")
    .notNull()
    .references(() => saleReturns.id),
  saleLineId: uuid("sale_line_id")
    .notNull()
    .references(() => saleLines.id),
  quantity: qty("quantity").notNull(),
  taxableValue: money("taxable_value").notNull(),
  cgstAmount: money("cgst_amount").notNull(),
  sgstAmount: money("sgst_amount").notNull(),
  igstAmount: money("igst_amount").notNull(),
  cessAmount: money("cess_amount").notNull(),
  lineTotal: money("line_total").notNull(),
  costTotal: money("cost_total"),
});

/* ------------------------------------------------------------------ */
/* Website enquiries & order requests                                  */
/* ------------------------------------------------------------------ */

export const websiteOrders = pgTable(
  "website_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull().unique(),
    kind: text("kind").$type<"enquiry" | "order_request">().notNull(),
    customerName: text("customer_name").notNull(),
    mobile: text("mobile").notNull(),
    email: text("email"),
    city: text("city"),
    address: text("address"),
    message: text("message"),
    preferredContact: text("preferred_contact").$type<"call" | "whatsapp" | "email">(),
    status: text("status")
      .$type<"new" | "contacted" | "quoted" | "converted" | "closed" | "spam">()
      .notNull()
      .default("new"),
    /** Indicative total at submission time (public prices); the shop confirms the final amount. */
    indicativeTotal: money("indicative_total"),
    convertedSaleId: uuid("converted_sale_id"),
    handledBy: uuid("handled_by").references(() => users.id),
    staffNotes: text("staff_notes"),
    ipHash: text("ip_hash"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("website_orders_status_idx").on(t.status, t.createdAt),
    check("website_orders_kind", sql`${t.kind} in ('enquiry','order_request')`),
    check(
      "website_orders_status",
      sql`${t.status} in ('new','contacted','quoted','converted','closed','spam')`,
    ),
  ],
);

export const websiteOrderLines = pgTable("website_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => websiteOrders.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  productName: text("product_name").notNull(),
  variantName: text("variant_name"),
  sku: text("sku").notNull(),
  quantity: qty("quantity").notNull(),
  indicativeUnitPrice: money("indicative_unit_price"),
  priceIncludesTax: boolean("price_includes_tax"),
});

/* ------------------------------------------------------------------ */
/* Online shop: customer accounts, coupons, paid pickup orders          */
/* ------------------------------------------------------------------ */

/** A website customer's sign-in (separate from staff users). Mobile is the username. */
export const shopAccounts = pgTable(
  "shop_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    mobile: text("mobile").notNull().unique(),
    email: text("email"),
    /** Set when the customer entered the code emailed to this address. */
    emailVerifiedAt: ts("email_verified_at"),
    passwordHash: text("password_hash").notNull(),
    /** Profile the customer keeps up to date (My profile): printed on their receipts and shown to staff. */
    businessName: text("business_name"),
    gstin: text("gstin"),
    altMobile: text("alt_mobile"),
    addressLine1: text("address_line1"),
    addressLine2: text("address_line2"),
    landmark: text("landmark"),
    city: text("city"),
    state: text("state"),
    pincode: text("pincode"),
    profileUpdatedAt: ts("profile_updated_at"),
    isActive: boolean("is_active").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  // One account per verified email address.
  (t) => [uniqueIndex("shop_accounts_email_verified_uq").on(sql`lower(${t.email})`).where(sql`${t.emailVerifiedAt} is not null`)],
);

/**
 * One-time codes emailed to a customer to prove an email address (at sign-up, or before paying). Only a keyed
 * hash of the code is kept; it expires, allows a few wrong tries, and works once.
 */
export const shopOtps = pgTable(
  "shop_otp_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purpose: text("purpose").$type<"sign_up" | "verify">().notNull(),
    email: text("email").notNull(),
    accountId: uuid("account_id").references(() => shopAccounts.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    consumedAt: ts("consumed_at"),
    ipHash: text("ip_hash"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("shop_otp_email_idx").on(t.email, t.purpose, t.createdAt)],
);

export const shopSessions = pgTable(
  "shop_sessions",
  {
    /** sha256 of the cookie token; the token itself is never stored. */
    id: text("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => shopAccounts.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("shop_sessions_account_idx").on(t.accountId)],
);

/** One generation run: N single-use codes, each worth a flat amount off. */
export const couponBatches = pgTable(
  "coupon_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    amountOff: money("amount_off").notNull(),
    /** The cart must be worth at least this much (before the discount). */
    minOrder: money("min_order").notNull().default("0"),
    validUntil: ts("valid_until"),
    codeCount: integer("code_count").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [check("coupon_batches_amount", sql`${t.amountOff} > 0 and ${t.minOrder} >= 0`)],
);

export type CouponStatus = "active" | "reserved" | "used" | "disabled";

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => couponBatches.id),
    /** active → reserved (an order is waiting for payment) → used (payment verified); or disabled. */
    status: text("status").$type<CouponStatus>().notNull().default("active"),
    orderId: uuid("order_id"),
    usedAt: ts("used_at"),
    disabledAt: ts("disabled_at"),
    disabledBy: uuid("disabled_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("coupons_batch_idx").on(t.batchId),
    check("coupons_status", sql`${t.status} in ('active','reserved','used','disabled')`),
    check("coupons_order_when_taken", sql`${t.status} not in ('reserved','used') or ${t.orderId} is not null`),
  ],
);

export type OnlineOrderStatus =
  | "awaiting_payment"
  | "payment_submitted"
  | "paid"
  | "payment_failed"
  | "confirmed"
  | "ready"
  | "collected"
  | "cancelled"
  | "expired"
  | "refunding"
  | "refunded";

/** Snapshot of the customer's profile on an order (what the receipt prints). */
export interface OrderCustomerDetails {
  businessName: string | null;
  gstin: string | null;
  altMobile: string | null;
  address: string[];
}

/** A paid-online, collect-at-the-store order placed by a signed-in customer. */
export const onlineOrders = pgTable(
  "online_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderNumber: text("order_number").notNull().unique(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => shopAccounts.id),
    customerName: text("customer_name").notNull(),
    mobile: text("mobile").notNull(),
    /** The customer's email and profile (address, business, GSTIN) as they were when the order was placed. */
    customerEmail: text("customer_email"),
    customerDetails: jsonb("customer_details").$type<OrderCustomerDetails>(),
    status: text("status").$type<OnlineOrderStatus>().notNull().default("awaiting_payment"),
    subtotal: money("subtotal").notNull(),
    discount: money("discount").notNull().default("0"),
    total: money("total").notNull(),
    couponId: uuid("coupon_id").references(() => coupons.id),
    couponCode: text("coupon_code"),
    /** "razorpay": paid in Razorpay's checkout, confirmed by its API. "upi_manual": QR + UTR, checked by staff. */
    paymentMethod: text("payment_method").$type<"upi_manual" | "razorpay">().notNull().default("upi_manual"),
    /** The UPI ID and exact request the QR encodes (manual UPI orders only). */
    upiVpa: text("upi_vpa"),
    qrPayload: text("qr_payload"),
    /** Razorpay: our receipt (order number + try), Razorpay's order id, and when the current try's payment time runs out. */
    gatewayMerchantOrderId: text("gateway_merchant_order_id").unique(),
    gatewayAttempt: integer("gateway_attempt").notNull().default(0),
    gatewayOrderId: text("gateway_order_id"),
    gatewayExpiresAt: ts("gateway_expires_at"),
    gatewayState: text("gateway_state"),
    gatewayTransactionId: text("gateway_transaction_id"),
    gatewayPaymentMode: text("gateway_payment_mode"),
    /** The bank reference Razorpay reports for a UPI payment (shown to staff; not the customer-typed `utr`). */
    gatewayUtr: text("gateway_utr"),
    gatewayCheckedAt: ts("gateway_checked_at"),
    refundMerchantId: text("refund_merchant_id").unique(),
    refundAttempt: integer("refund_attempt").notNull().default(0),
    refundGatewayId: text("refund_gateway_id"),
    refundState: text("refund_state"),
    refundAmount: money("refund_amount"),
    refundReason: text("refund_reason"),
    refundedAt: ts("refunded_at"),
    /** Pay (and send the UTR) before this time; afterwards the order expires and any coupon is freed. */
    expiresAt: ts("expires_at").notNull(),
    utr: text("utr"),
    utrSubmittedAt: ts("utr_submitted_at"),
    verifiedBy: uuid("verified_by").references(() => users.id),
    verifiedAt: ts("verified_at"),
    verificationNote: text("verification_note"),
    failureReason: text("failure_reason"),
    /** The shop accepted the order: from here the customer can no longer cancel it themselves. */
    confirmedAt: ts("confirmed_at"),
    confirmedBy: uuid("confirmed_by").references(() => users.id),
    readyAt: ts("ready_at"),
    collectedAt: ts("collected_at"),
    /** Staff remarks recorded when the items were handed over at the counter. */
    collectNote: text("collect_note"),
    cancelledAt: ts("cancelled_at"),
    cancelReason: text("cancel_reason"),
    handledBy: uuid("handled_by").references(() => users.id),
    /** Deleted by the Super Admin: hidden everywhere; the row stays so late payments and the log still resolve. */
    deletedAt: ts("deleted_at"),
    deletedBy: uuid("deleted_by").references(() => users.id),
    deleteReason: text("delete_reason"),
    ipHash: text("ip_hash"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("online_orders_status_idx").on(t.status, t.createdAt),
    index("online_orders_account_idx").on(t.accountId, t.createdAt),
    check(
      "online_orders_status",
      sql`${t.status} in ('awaiting_payment','payment_submitted','paid','payment_failed','confirmed','ready','collected','cancelled','expired','refunding','refunded')`,
    ),
    check("online_orders_amounts", sql`${t.discount} >= 0 and ${t.total} > 0 and ${t.total} = ${t.subtotal} - ${t.discount}`),
    check("online_orders_method", sql`${t.paymentMethod} in ('upi_manual','razorpay')`),
    check(
      "online_orders_paid_verified",
      sql`${t.status} not in ('paid','confirmed','ready','collected') or (${t.verifiedAt} is not null and (${t.utr} is not null or ${t.gatewayTransactionId} is not null))`,
    ),
    check("online_orders_manual_qr", sql`${t.paymentMethod} <> 'upi_manual' or (${t.upiVpa} is not null and ${t.qrPayload} is not null)`),
    // One UTR can back only one live order.
    uniqueIndex("online_orders_utr_uq")
      .on(sql`upper(${t.utr})`)
      .where(sql`${t.utr} is not null and ${t.status} in ('payment_submitted','paid','confirmed','ready','collected')`),
    // One coupon can sit on only one live order.
    uniqueIndex("online_orders_coupon_uq")
      .on(t.couponId)
      .where(sql`${t.couponId} is not null and ${t.status} not in ('payment_failed','cancelled','expired','refunding','refunded')`),
  ],
);

export const onlineOrderLines = pgTable(
  "online_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => onlineOrders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    productName: text("product_name").notNull(),
    variantName: text("variant_name"),
    sku: text("sku").notNull(),
    unit: text("unit").notNull(),
    quantity: qty("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    lineTotal: money("line_total").notNull(),
  },
  (t) => [index("online_order_lines_order_idx").on(t.orderId)],
);
