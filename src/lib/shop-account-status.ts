import type { ShopAccountStatus } from "@/server/db/schema";

/** How a website account's state is named for staff, with its badge tone and what it means. */
export const SHOP_ACCOUNT_STATUS: Record<ShopAccountStatus, { label: string; tone: "green" | "amber" | "red" | "neutral"; means: string }> = {
  active: { label: "Active", tone: "green", means: "Can sign in and order." },
  frozen: { label: "Frozen", tone: "amber", means: "On hold: signed out, can't sign in or order until unfrozen." },
  banned: { label: "Banned", tone: "red", means: "Blocked for fraud: can't sign in; its mobile and email can't sign up again." },
  deleted: { label: "Deleted", tone: "neutral", means: "Personal details erased; past orders kept as the shop's sales record." },
};
