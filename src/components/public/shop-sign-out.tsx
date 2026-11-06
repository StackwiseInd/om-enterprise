"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export function ShopSignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await apiFetch("/api/shop/auth/signout", { body: {} }).catch(() => {});
        router.replace("/");
        router.refresh();
      }}
      className="link-draw font-semibold text-navy-950 disabled:opacity-50"
    >
      Sign out
    </button>
  );
}
