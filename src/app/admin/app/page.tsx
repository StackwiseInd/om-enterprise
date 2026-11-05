import { Suspense } from "react";
import Link from "next/link";
import { BadgeCheck, Check, ChevronRight, Circle, Plus, Search, Wallet } from "lucide-react";
import { can } from "@/server/auth/actor";
import { ownerLang } from "@/server/owner-lang";
import { ownerDay, ownerWaiting, setupChecklist, type SetupItem } from "@/server/services/owner";
import { requireOwner } from "./guard";
import { formatINR } from "@/lib/money";
import { METHOD_NAMES, type OwnerKey, type T } from "@/lib/owner-i18n";
import { InstallCard } from "@/components/owner/install-card";
import { cn } from "@/components/ui/cn";

export const metadata = { title: "Owner" };

export default function OwnerHomePage() {
  return (
    <Suspense fallback={<div className="space-y-4">{[0, 1, 2].map((i) => <div key={i} className="h-28 animate-pulse rounded-xl bg-navy-100/60" />)}</div>}>
      <Home />
    </Suspense>
  );
}

async function Home() {
  const actor = await requireOwner();
  const { lang, t } = await ownerLang();
  const now = new Date();
  const [day, waiting, setup] = await Promise.all([
    can(actor, "reports.view") ? ownerDay(actor, now) : null,
    ownerWaiting(actor),
    actor.isSuperAdmin ? setupChecklist() : Promise.resolve([] as SetupItem[]),
  ]);
  // Price changes are approved together in one go, so they count as one thing to do.
  const owed = waiting.discounts + (waiting.prices > 0 ? 1 : 0) + waiting.orders;
  const first = actor.displayName.split(" ")[0];
  const date = now.toLocaleDateString(lang === "en" ? "en-IN" : lang === "gu" ? "gu-IN" : "hi-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });
  const cash = day?.byMethod.find((b) => b.method === "cash")?.amount ?? "0";
  const upi = day?.byMethod.find((b) => b.method === "upi")?.amount ?? "0";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="headline text-[1.5rem] font-bold text-navy-950">
          {t("hello")}, {first}
        </h1>
        <p className="text-sm text-navy-500">{date}</p>
      </div>

      <form action="/admin/app/find" className="flex gap-2">
        <input
          name="q"
          type="search"
          enterKeyHint="search"
          placeholder={t("searchPlaceholder")}
          aria-label={t("search")}
          className="h-12 min-w-0 flex-1 rounded-lg border border-navy-200 bg-white px-3.5 text-base text-navy-950 placeholder:text-navy-400 focus:border-navy-500 focus:outline-none"
        />
        <button type="submit" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-navy-900 text-white" aria-label={t("search")}>
          <Search className="h-5 w-5" />
        </button>
      </form>

      <div className="grid grid-cols-2 gap-3">
        {can(actor, "sales.create") && <Tile href="/pos" icon={<Plus className="h-6 w-6" strokeWidth={2.5} />} title={t("newSale")} hint={t("newSaleHint")} gold />}
        <Tile href="/admin/app/approvals" icon={<BadgeCheck className="h-6 w-6" />} title={t("approvals")} hint={owed ? `${owed} · ${t("approvalsHint")}` : t("nothingWaiting")} badge={owed} />
        {day && <Tile href="/admin/app/today" icon={<Wallet className="h-6 w-6" />} title={t("todayMoney")} hint={`${formatINR(day.received)} · ${day.bills} ${(day.bills === 1 ? t("bill") : t("bills")).toLowerCase()}`} />}
        <Tile href="/admin/app/find" icon={<Search className="h-6 w-6" />} title={t("find")} hint={t("findHint")} />
      </div>

      {day && (
        <Link href="/admin/app/today" className="block rounded-xl border border-navy-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="label-sm text-navy-500">{t("today")}</span>
            <ChevronRight className="h-4 w-4 text-navy-400" />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-center">
            <Figure label={t("received")} value={formatINR(day.received)} />
            <Figure label={METHOD_NAMES[lang].cash} value={formatINR(cash)} />
            <Figure label={METHOD_NAMES[lang].upi} value={formatINR(upi)} />
          </div>
        </Link>
      )}

      {setup.length > 0 && <Setup items={setup} t={t} />}

      <InstallCard title={t("installTitle")} hint={t("installHint")} install={t("install")} iosHint={t("installIos")} />
    </div>
  );
}

function Tile({ href, icon, title, hint, gold, badge }: { href: string; icon: React.ReactNode; title: string; hint: string; gold?: boolean; badge?: number }) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-h-32 flex-col justify-between gap-3 rounded-xl p-4 transition-colors active:translate-y-px",
        gold ? "bg-gold-500 text-navy-950 hover:bg-gold-400" : "border border-navy-200 bg-white text-navy-950 hover:border-navy-400",
      )}
    >
      <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", gold ? "bg-navy-950 text-gold-400" : "bg-navy-50 text-navy-800")}>{icon}</span>
      {!!badge && <span className="absolute right-3 top-3 min-w-6 rounded-full bg-red-700 px-1.5 py-0.5 text-center text-xs font-bold text-white tabular">{badge}</span>}
      <span>
        <span className="block text-[17px] font-bold leading-tight">{title}</span>
        <span className={cn("mt-0.5 block text-[13px] leading-snug", gold ? "text-navy-900" : "text-navy-500")}>{hint}</span>
      </span>
    </Link>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[17px] font-bold text-navy-950 tabular">{value}</div>
      <div className="text-xs text-navy-500">{label}</div>
    </div>
  );
}

/** The GST step names the type that was chosen once it is confirmed; until then it only asks for it. */
function setupLabel(i: SetupItem, t: T): string {
  if (i.key === "tax" && i.done && i.registrationType) return t(`setup.tax.${i.registrationType}`);
  return t(`setup.${i.key}` as OwnerKey);
}

function Setup({ items, t }: { items: SetupItem[]; t: T }) {
  const required = items.filter((i) => !i.optional);
  const done = required.filter((i) => i.done).length;
  if (done === required.length) return null;
  return (
    <section className="rounded-xl border border-navy-200 bg-white" aria-labelledby="setup-h">
      <div className="flex items-center justify-between gap-3 border-b border-navy-100 px-4 py-3">
        <h2 id="setup-h" className="font-bold text-navy-950">
          {t("setupTitle")}
        </h2>
        <span className="text-sm text-navy-500 tabular">
          {done}/{required.length} {t("setupDone")}
        </span>
      </div>
      <ul className="divide-y divide-navy-100">
        {items.map((i) => (
          <li key={i.key} className="flex items-start gap-3 px-4 py-3">
            {i.done ? <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-navy-300" />}
            <div className="min-w-0 flex-1">
              <div className={cn("font-semibold", i.done ? "text-navy-500 line-through decoration-navy-300" : "text-navy-950")}>
                {setupLabel(i, t)}
                {i.optional && !i.done && <span className="ml-1.5 text-xs font-normal text-navy-500">({t("optional")})</span>}
              </div>
              {!i.done && (
                <p className="mt-0.5 text-sm text-navy-600">
                  {i.key === "prices" ? `${i.count} ${t("setup.prices.hint")}` : t(`setup.${i.key}.hint` as OwnerKey)}
                  {!i.href && <span className="mt-0.5 block text-xs text-navy-500">{t("askSetup")}</span>}
                </p>
              )}
            </div>
            {!i.done && i.href && (
              <Link href={i.href} className="shrink-0 rounded-lg border border-navy-300 px-3 py-1.5 text-sm font-semibold text-navy-900 hover:border-navy-600">
                {t("doIt")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
