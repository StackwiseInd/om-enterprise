/**
 * Permission catalogue. Enforcement happens on the server (`requirePermission`);
 * the client only uses this to decide what to show.
 *
 * Effective permissions = role permissions + user "grant" overrides − user "deny" overrides.
 * The super_admin role implicitly holds every permission and cannot be denied any.
 */

export const PERMISSIONS = {
  // Dashboard & catalogue
  "dashboard.view": "See the business dashboard",
  "catalog.view": "View all products incl. unpublished/inactive",
  "catalog.create": "Create products, variants, categories, brands",
  "catalog.edit": "Edit products, variants, images, specifications",
  "catalog.publish": "Publish / unpublish products on the website",
  "catalog.import": "Bulk import products from spreadsheets",

  // Pricing & cost
  "prices.edit": "Propose selling price changes (may need approval)",
  "prices.approve": "Approve price changes / set prices without approval",
  "costs.view": "See purchase & landed costs, margins and profit",
  "costs.edit": "Record purchase / landed costs",

  // Discounts
  "discounts.apply": "Apply discounts within personal limit",
  "discounts.approve": "Approve discounts above others' limits (up to own approval limit)",
  "discounts.configure": "Configure discount policy, limits & margin floors",
  "pricing.override_price": "Change the unit price on a sale line (still checked by limits)",
  "pricing.sell_below_cost": "Authorise sales below cost / margin floor",

  // Sales
  "sales.create": "Use the POS: create sales and quotations",
  "sales.view_all": "View all staff members' sales (otherwise own only)",
  "sales.cancel": "Cancel unpaid sales created by others",
  "sales.credit": "Issue a bill with an outstanding (unpaid) balance",

  // Payments
  "payments.record": "Generate payment QR / record payments",
  "payments.verify": "Confirm a payment after checking the merchant app / cash",
  "payments.refund": "Record refunds",
  "payments.reverse": "Reverse a wrongly confirmed payment",
  "payments.view": "View payment history",

  // Documents
  "documents.issue": "Issue invoices / bills of supply / quotations",
  "documents.reprint": "Reprint and download issued documents",
  "documents.share": "Create customer share links",
  "documents.cancel": "Cancel an issued invoice (with reason)",
  "documents.credit_note": "Process returns and issue credit notes",

  // Customers & website orders
  "customers.view": "View customer records",
  "customers.edit": "Create and edit customer records",
  "customers.ban": "Ban, delete and block website customers (mobile numbers and emails)",
  "orders.view": "View website enquiries and order requests",
  "orders.manage": "Update / convert website orders",

  // Reports & audit
  "reports.view": "Sales, collections and discount reports",
  "reports.profit": "Profit & margin reports (needs costs.view)",
  "reports.export": "Export reports as CSV",
  "audit.view": "View the audit log",

  // Administration
  "users.manage": "Create / deactivate non-admin staff and reset their passwords",
  "settings.business": "Edit business details & branding",
  "settings.tax": "Edit GST registration & tax configuration",
  "settings.payment": "Edit payment configuration",
  "settings.documents": "Edit document numbering & templates",

  // Inventory (future module)
  "inventory.view": "View stock information (when enabled)",
  "inventory.manage": "Record stock movements & suppliers (when enabled)",
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/**
 * Only the Super Admin can ever do these — they cannot be granted to any other role or user.
 * (Assigning permissions/roles is itself super-admin only and not part of the catalogue.)
 */
export const SUPER_ADMIN_ONLY: readonly string[] = ["settings.security", "permissions.manage"];

export const PERMISSION_GROUPS: { label: string; prefix: string[] }[] = [
  { label: "Catalogue", prefix: ["dashboard.", "catalog."] },
  { label: "Pricing & cost", prefix: ["prices.", "costs.", "pricing."] },
  { label: "Discounts", prefix: ["discounts."] },
  { label: "Sales", prefix: ["sales."] },
  { label: "Payments", prefix: ["payments."] },
  { label: "Documents", prefix: ["documents."] },
  { label: "Customers & orders", prefix: ["customers.", "orders."] },
  { label: "Reports & audit", prefix: ["reports.", "audit."] },
  { label: "Administration", prefix: ["users.", "settings."] },
  { label: "Inventory", prefix: ["inventory."] },
];

export type RoleKey = "super_admin" | "admin" | "sales" | "accountant";

/** Initial role templates. Super Admin can edit role permissions and per-user overrides. */
export const DEFAULT_ROLES: {
  key: RoleKey;
  name: string;
  description: string;
  discountLimit: string;
  approvalLimit: string;
  permissions: Permission[];
}[] = [
  {
    key: "super_admin",
    name: "Super Admin",
    description: "Owner. Complete oversight; implicitly holds every permission.",
    discountLimit: "100",
    approvalLimit: "100",
    permissions: [...ALL_PERMISSIONS],
  },
  {
    key: "admin",
    name: "Admin",
    description:
      "Manages catalogue, assigned price lists and daily operations. Financial/security powers are granted individually by the Super Admin.",
    discountLimit: "10",
    approvalLimit: "15",
    permissions: [
      "dashboard.view",
      "catalog.view",
      "catalog.create",
      "catalog.edit",
      "catalog.publish",
      "catalog.import",
      "prices.edit",
      "costs.view",
      "discounts.apply",
      "discounts.approve",
      "sales.create",
      "sales.view_all",
      "payments.record",
      "payments.verify",
      "payments.view",
      "documents.issue",
      "documents.reprint",
      "documents.share",
      "customers.view",
      "customers.edit",
      "customers.ban",
      "orders.view",
      "orders.manage",
      "reports.view",
      "reports.profit",
      "reports.export",
      "inventory.view",
    ],
  },
  {
    key: "sales",
    name: "Sales & Operations",
    description: "Runs the counter: POS sales, quotations, payment confirmation and bills.",
    discountLimit: "5",
    approvalLimit: "0",
    permissions: [
      "discounts.apply",
      "sales.create",
      "payments.record",
      "payments.verify",
      "payments.view",
      "documents.issue",
      "documents.reprint",
      "documents.share",
      "customers.view",
      "customers.edit",
      "orders.view",
      "orders.manage",
    ],
  },
  {
    key: "accountant",
    name: "Accountant / Auditor",
    description: "Read-only financial review: transactions, invoices, payments, reports and audit trail.",
    discountLimit: "0",
    approvalLimit: "0",
    permissions: [
      "dashboard.view",
      "catalog.view",
      "costs.view",
      "sales.view_all",
      "payments.view",
      "documents.reprint",
      "customers.view",
      "orders.view",
      "reports.view",
      "reports.profit",
      "reports.export",
      "audit.view",
      "inventory.view",
    ],
  },
];

export function isPermission(p: string): p is Permission {
  return p in PERMISSIONS;
}
