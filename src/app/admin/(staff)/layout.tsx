import { Suspense } from "react";
import { Sidebar, SidebarSkeleton } from "@/components/staff/sidebar";
import { ToastProvider } from "@/components/ui/toast";

export const metadata = { title: { default: "Admin", template: "%s · OM ENTERPRISE" }, robots: { index: false } };

/** Admin pages (logs, deletion requests, blocklist) use the same frame as the dashboard: sidebar on the left, the page on the right. */
export default function AdminStaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <div className="flex min-h-dvh flex-1 flex-col bg-paper/50 lg:flex-row">
        <Suspense fallback={<SidebarSkeleton />}>
          <Sidebar />
        </Suspense>
        <main className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[1360px] px-4 pb-16 pt-6 sm:px-6 lg:px-10 lg:pt-9">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
