import type { Permission } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  /** Shown if the user holds ANY of these (Super Admin sees all). */
  any?: Permission[];
  superAdminOnly?: boolean;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const STAFF_NAV: NavGroup[] = [
  {
    label: "Counter",
    items: [
      { href: "/pos", label: "Point of Sale", icon: "store", any: ["sales.create"] },
      { href: "/dashboard", label: "Overview", icon: "gauge", any: ["dashboard.view"] },
      { href: "/admin/app", label: "Owner app (phone)", icon: "smartphone", any: ["dashboard.view"] },
    ],
  },
  {
    label: "Sales",
    items: [
      { href: "/dashboard/sales", label: "Sales & bills", icon: "receipt", any: ["sales.view_all", "sales.create"] },
      { href: "/dashboard/approvals", label: "Approvals", icon: "badge-check", any: ["discounts.approve", "prices.approve"] },
      { href: "/dashboard/payments", label: "Payments", icon: "wallet", any: ["payments.view"] },
      { href: "/dashboard/documents", label: "Documents", icon: "file-text", any: ["documents.reprint", "sales.view_all"] },
      { href: "/dashboard/customers", label: "Customers", icon: "users", any: ["customers.view"] },
      { href: "/dashboard/online-orders", label: "Online orders", icon: "shopping-bag", any: ["orders.view", "payments.verify"] },
      { href: "/dashboard/website-customers", label: "Online customers", icon: "user-round", any: ["customers.view"] },
      { href: "/dashboard/orders", label: "Website orders", icon: "globe", any: ["orders.view"] },
      { href: "/dashboard/coupons", label: "Discount codes", icon: "ticket", any: ["discounts.configure"] },
    ],
  },
  {
    label: "Catalogue",
    items: [
      { href: "/dashboard/products", label: "Products", icon: "package", any: ["catalog.view", "catalog.edit"] },
      { href: "/dashboard/categories", label: "Categories & brands", icon: "folder", any: ["catalog.edit", "catalog.create"] },
      { href: "/dashboard/pricing", label: "Price review", icon: "tags", any: ["prices.edit", "prices.approve", "costs.view"] },
      { href: "/dashboard/import", label: "Bulk import", icon: "upload", any: ["catalog.import"] },
      { href: "/dashboard/inventory", label: "Inventory", icon: "boxes", any: ["inventory.view", "inventory.manage"] },
    ],
  },
  {
    label: "Insights",
    items: [{ href: "/dashboard/reports", label: "Reports", icon: "chart", any: ["reports.view"] }],
  },
  {
    label: "Administration",
    items: [
      { href: "/dashboard/staff", label: "Staff & access", icon: "shield", any: ["users.manage"] },
      { href: "/dashboard/settings", label: "Settings", icon: "settings", any: ["settings.business", "settings.tax", "settings.payment", "settings.documents", "discounts.configure"] },
      { href: "/dashboard/audit", label: "Audit log", icon: "history", any: ["audit.view"] },
      { href: "/admin/logs/online-orders", label: "Online orders log", icon: "history", any: ["audit.view"] },
    ],
  },
];

export function visibleNav(perms: ReadonlySet<string> | string[], isSuperAdmin: boolean): NavGroup[] {
  const set = perms instanceof Set ? perms : new Set(perms);
  return STAFF_NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => isSuperAdmin || (!i.superAdminOnly && (!i.any || i.any.some((p) => set.has(p))))),
  })).filter((g) => g.items.length);
}

export function landingPath(perms: ReadonlySet<string> | string[], isSuperAdmin: boolean): string {
  const set = perms instanceof Set ? perms : new Set(perms);
  if (isSuperAdmin || set.has("dashboard.view")) return "/dashboard";
  if (set.has("sales.create")) return "/pos";
  return "/dashboard/sales";
}
