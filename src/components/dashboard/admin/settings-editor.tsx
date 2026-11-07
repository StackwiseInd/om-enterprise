"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { apiFetch, ApiError, errorMessage } from "@/lib/api-client";
import { STATES } from "@/lib/india";
import type { Settings } from "@/lib/settings-schema";
import { TabStrip } from "@/components/staff/tab-strip";

export type SectionKey = keyof Settings;

/** `advanced`: rarely changed; kept behind "More settings" so each section shows what the owner actually uses. */
type FieldSpec = { advanced?: boolean } & (
  | { key: string; label: string; type: "text" | "textarea" | "email" | "url"; hint?: string; wide?: boolean; placeholder?: string }
  | { key: string; label: string; type: "number"; hint?: string; min?: number; max?: number }
  | { key: string; label: string; type: "decimal"; hint?: string; blankAllowed?: boolean }
  | { key: string; label: string; type: "checkbox"; hint?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[]; hint?: string; numeric?: boolean }
  | { key: string; label: string; type: "list"; hint?: string }
);

const SECTIONS: Record<SectionKey, { title: string; description: string; fields: FieldSpec[] }> = {
  business: {
    title: "Business details",
    description: "Printed on bills and shown on the website.",
    fields: [
      { key: "name", label: "Business name", type: "text" },
      { key: "tagline", label: "Tagline", type: "text", advanced: true },
      { key: "addressLine1", label: "Address line 1", type: "text", wide: true },
      { key: "addressLine2", label: "Address line 2", type: "text", wide: true },
      { key: "city", label: "City / town", type: "text" },
      { key: "district", label: "District", type: "text" },
      { key: "stateCode", label: "State", type: "select", options: STATES.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` })) },
      { key: "pincode", label: "PIN code", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "whatsapp", label: "WhatsApp number", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "gstin", label: "GSTIN", type: "text", hint: "Required before issuing GST tax invoices. Checked for format and check digit." },
      { key: "pan", label: "PAN", type: "text", advanced: true },
      { key: "openingHours", label: "Opening hours", type: "text", hint: "Shown on the website. Leave blank to hide.", placeholder: "e.g. Mon–Sat 9:00 am – 8:00 pm" },
      { key: "mapUrl", label: "Google Maps link", type: "url", wide: true, advanced: true },
      { key: "mapEmbedUrl", label: "Map shown on the website", type: "text", wide: true, advanced: true, hint: "Google Maps → Share → Embed a map → copy the HTML, and paste it here (the whole <iframe> snippet is fine). Leave blank to hide the map." },
      { key: "about", label: "About the business", type: "textarea", wide: true, advanced: true },
    ],
  },
  tax: {
    title: "GST & tax",
    description: "Decides which billing document is issued and how tax is calculated. Confirm with your accountant before changing.",
    fields: [
      { key: "pricesIncludeTaxByDefault", label: "New prices include GST by default", type: "checkbox", advanced: true },
      { key: "roundOff", label: "Round bill total", type: "select", advanced: true, options: [{ value: "nearest_rupee", label: "To the nearest rupee (shows a round-off line)" }, { value: "none", label: "No rounding (paise)" }] },
      {
        key: "hsnMinDigits",
        label: "Minimum HSN digits on tax invoices",
        type: "select",
        advanced: true,
        numeric: true,
        options: [
          { value: "4", label: "4 digits (turnover up to ₹5 crore)" },
          { value: "6", label: "6 digits (turnover above ₹5 crore)" },
          { value: "8", label: "8 digits" },
        ],
      },
      { key: "b2cDetailsThreshold", label: "Unregistered buyer details required from (₹)", type: "decimal", hint: "Rule 46(e): name, address and state are mandatory at or above this taxable value.", advanced: true },
      { key: "confirmedBy", label: "Confirmed with (accountant)", type: "text" },
      { key: "confirmedNote", label: "Notes", type: "textarea", wide: true, advanced: true },
    ],
  },
  documents: {
    title: "Billing documents",
    description: "Numbering, terms and the text printed on bills, quotations and credit notes.",
    fields: [
      { key: "quotationValidityDays", label: "Quotation valid for (days)", type: "number", min: 1, max: 90 },
      { key: "signatoryLabel", label: "Signatory line", type: "text", wide: true, advanced: true },
      { key: "footerNote", label: "Footer note", type: "text", wide: true },
      { key: "terms", label: "Terms & conditions (one per line)", type: "list", hint: "Agree these with your accountant. Leave empty to print none." },
      { key: "bankDetails", label: "Bank details (printed on bills)", type: "textarea", wide: true },
      { key: "shareLinksEnabled", label: "Allow customer share links (view/download a bill via a private link)", type: "checkbox", advanced: true },
    ],
  },
  payments: {
    title: "Payments",
    description: "How customers can pay at the counter.",
    fields: [
      { key: "upiEnabled", label: "Show UPI QR codes with the exact bill amount", type: "checkbox" },
      { key: "upiVpa", label: "Shop UPI ID", type: "text", placeholder: "shopname@bank" },
      { key: "upiPayeeName", label: "Payee name shown in UPI apps", type: "text" },
      { key: "upiMerchantCode", label: "Merchant category code (MCC)", type: "text", hint: "Only if this UPI ID is a verified merchant account with an MCC. Leave blank otherwise.", advanced: true },
      { key: "qrExpiryMinutes", label: "QR valid for (minutes)", type: "number", min: 2, max: 120, advanced: true },
      { key: "maxPerUpiPayment", label: "Maximum per UPI payment (₹)", type: "decimal", hint: "Most UPI merchant payments are limited to ₹1,00,000 each — larger bills are split.", advanced: true },
      { key: "requireUpiReference", label: "Require the 12-digit UTR when confirming UPI payments", type: "checkbox", advanced: true },
      { key: "cashEnabled", label: "Accept cash", type: "checkbox" },
      { key: "cardEnabled", label: "Accept card (via a separate card machine)", type: "checkbox" },
      { key: "bankTransferEnabled", label: "Accept bank transfer (NEFT/IMPS/RTGS)", type: "checkbox" },
      { key: "chequeEnabled", label: "Accept cheques (record only after clearance)", type: "checkbox" },
      {
        key: "gatewayProvider",
        label: "Automatic payment confirmation",
        type: "select",
        advanced: true,
        options: [
          { value: "none", label: "None — staff verify every payment manually" },
          { value: "razorpay", label: "Razorpay dynamic UPI QR (needs API keys)" },
        ],
      },
    ],
  },
  discounts: {
    title: "Discounts & margins",
    description: "Business-wide discount policy. Individual limits are set per staff member under Staff & access.",
    fields: [
      { key: "minMarginPercent", label: "Minimum gross margin %", type: "decimal", blankAllowed: true, hint: "Sales below this margin need approval. Blank = no floor. Category/product overrides win." },
      { key: "targetMarginPercent", label: "Target gross margin %", type: "decimal", blankAllowed: true, hint: "Used for price suggestions. Margin is on selling price, not markup on cost.", advanced: true },
      { key: "requireReasonForAnyDiscount", label: "Require a reason for every discount", type: "checkbox", advanced: true },
      { key: "inPersonApprovalEnabled", label: "Allow a manager to approve at the counter with their own password", type: "checkbox" },
      { key: "allowCreditSales", label: "Allow bills with an unpaid balance (credit sales) for permitted staff", type: "checkbox" },
    ],
  },
  pricing: {
    title: "Price changes",
    description: "Controls on changes to selling prices.",
    fields: [
      { key: "priceChangeRequiresApproval", label: "Price changes by staff without approval rights wait for approval", type: "checkbox" },
      { key: "reviewAfterDays", label: "Flag prices not reviewed for (days)", type: "number", min: 7, max: 3650 },
    ],
  },
  security: {
    title: "Security",
    description: "Sign-in and session rules for all staff.",
    fields: [
      { key: "sessionIdleMinutes", label: "Sign out after inactivity (minutes)", type: "number", min: 10, max: 1440 },
      { key: "sessionMaxHours", label: "Maximum session length (hours)", type: "number", min: 1, max: 720 },
      { key: "maxFailedLogins", label: "Lock account after failed sign-ins", type: "number", min: 3, max: 20 },
      { key: "lockoutMinutes", label: "Lock duration (minutes)", type: "number", min: 1, max: 1440 },
      { key: "minPasswordLength", label: "Minimum password length", type: "number", min: 10, max: 64 },
    ],
  },
  website: {
    title: "Website",
    description: "What customers see on the public website.",
    fields: [
      { key: "showPrices", label: "Show prices on the website", type: "checkbox" },
      { key: "priceNote", label: "Price note", type: "textarea", wide: true },
      { key: "enquiriesEnabled", label: "Accept online enquiries and order requests", type: "checkbox" },
      { key: "heroTitle", label: "Homepage headline", type: "text", wide: true },
      { key: "heroSubtitle", label: "Homepage sub-headline", type: "textarea", wide: true },
    ],
  },
  alerts: {
    title: "Owner alerts",
    description: "Emails to the owner: a summary of the day every evening, and a note when staff ask for a discount approval. Sent from the shop's email.",
    fields: [
      { key: "ownerEmail", label: "Send to (owner's email)", type: "email", hint: "Leave blank to send nothing." },
      { key: "dailySummary", label: "Evening summary at about 8:30 pm: sales, cash and UPI received, bills, discounts, what's waiting", type: "checkbox" },
      { key: "approvalAlerts", label: "Email me when staff ask for a discount approval", type: "checkbox" },
    ],
  },
  inventory: {
    title: "Inventory",
    description: "Stock tracking is ready but OFF until opening stock has been counted and entered.",
    fields: [
      { key: "enabled", label: "Enable inventory (stock movements & levels)", type: "checkbox" },
      { key: "deductStockOnSale", label: "Deduct stock automatically when a bill is issued (and add back on returns)", type: "checkbox" },
    ],
  },
};

const ORDER: SectionKey[] = ["business", "tax", "documents", "payments", "discounts", "alerts", "website"];
/** Tabs the owner rarely needs, listed under "Advanced". */
const ADVANCED: SectionKey[] = ["pricing", "security", "inventory"];

type TaxClass = { id: string; name: string; gstRate: string; cessRate: string; isExempt: boolean; description: string | null };

export function SettingsEditor({
  settings,
  editable,
  initial,
  razorpayConfigured,
  taxClasses,
  canEditTaxClasses,
  currentFy,
}: {
  currentFy: string;
  settings: Settings;
  editable: SectionKey[];
  initial?: SectionKey;
  razorpayConfigured: boolean;
  taxClasses: TaxClass[];
  canEditTaxClasses: boolean;
}) {
  const main = ORDER.filter((k) => editable.includes(k));
  const advanced = ADVANCED.filter((k) => editable.includes(k));
  const sections = [...main, ...advanced];
  const [active, setActive] = useState<SectionKey>(initial && sections.includes(initial) ? initial : sections[0]);
  if (!sections.length) return <Alert>You cannot edit any settings.</Alert>;
  return (
    <div className="grid gap-6 lg:grid-cols-[208px_minmax(0,1fr)] lg:items-start">
      <TabStrip
        className="-mx-4 flex gap-5 overflow-x-auto border-b border-navy-200 px-4 max-lg:relative max-lg:scroll-fade-x sm:mx-0 sm:pl-0 lg:sticky lg:top-8 lg:flex-col lg:gap-0 lg:border-b-0 lg:border-l lg:px-0"
        label="Settings sections"
      >
        {sections.map((k) => [
          k === advanced[0] && main.length > 0 && (
            <span key="advanced-label" className="label-sm shrink-0 self-center whitespace-nowrap pb-2.5 pt-1 text-navy-400 lg:mt-4 lg:self-start lg:py-2 lg:pl-4">
              Advanced
            </span>
          ),
          <button
            key={k}
            type="button"
            onClick={() => setActive(k)}
            aria-current={k === active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 pb-2.5 pt-1 text-left text-sm font-semibold transition-colors duration-150 lg:-ml-px lg:mb-0 lg:border-b-0 lg:border-l-2 lg:py-2 lg:pl-4",
              k === active ? "border-gold-500 text-navy-950" : "border-transparent text-navy-500 hover:border-navy-300 hover:text-navy-900",
            )}
          >
            {SECTIONS[k].title}
          </button>,
        ])}
      </TabStrip>
      <div className="min-w-0 space-y-6">
        {active === "tax" && <RegistrationCard current={settings.tax.registrationType} gstin={settings.business.gstin} all={settings.tax} />}
        <SectionForm key={active} section={active} value={settings[active] as unknown as Record<string, unknown>} razorpayConfigured={razorpayConfigured} />
        {active === "documents" && (
          <MoreCards label="Bill numbering">
            <PrefixesForm value={settings.documents} fy={currentFy} />
          </MoreCards>
        )}
        {active === "tax" && (
          <MoreCards label="GST rate classes">
            <TaxClasses classes={taxClasses} canEdit={canEditTaxClasses} />
          </MoreCards>
        )}
      </div>
    </div>
  );
}

function useSave(section: SectionKey) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (value: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/admin/settings/${section}`, { method: "PUT", body: value });
      toast("Settings saved");
      router.refresh();
      return true;
    } catch (err) {
      const issues = err instanceof ApiError ? (err.details?.issues as { path: string[]; message: string }[] | undefined) : undefined;
      setError(issues?.length ? issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ") : errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { save, busy, error };
}

function SectionForm({ section, value, razorpayConfigured }: { section: SectionKey; value: Record<string, unknown>; razorpayConfigured: boolean }) {
  const spec = SECTIONS[section];
  const [form, setForm] = useState<Record<string, unknown>>(value);
  const [more, setMore] = useState(false);
  const { save, busy, error } = useSave(section);
  const extra = spec.fields.filter((f) => f.advanced).length;
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Card>
      <CardHeader title={spec.title} description={spec.description} />
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save(form);
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          {error && <Alert tone="danger" className="sm:col-span-2">{error}</Alert>}
          {section === "payments" && form.gatewayProvider === "razorpay" && (
            <Alert tone={razorpayConfigured ? "success" : "warning"} className="sm:col-span-2" title={razorpayConfigured ? "Razorpay keys found on the server" : "Razorpay keys are not configured"}>
              {razorpayConfigured
                ? "Dynamic QR codes will be created through Razorpay and confirmed by its signed webhook. Test with a ₹1 live payment before relying on it."
                : "Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET on the server and enable QR Codes on your Razorpay account. Until then the static UPI QR with manual verification is used."}
            </Alert>
          )}
          {section === "inventory" && Boolean(form.deductStockOnSale) && (
            <Alert tone="warning" className="sm:col-span-2">
              Only turn on automatic deduction after opening stock for every product has been counted and recorded — otherwise stock levels will be wrong.
            </Alert>
          )}
          {spec.fields.filter((f) => more || !f.advanced).map((f) => {
            const id = `${section}-${f.key}`;
            const v = form[f.key];
            if (f.type === "checkbox") {
              return (
                <div key={f.key} className="sm:col-span-2">
                  <Checkbox id={id} checked={Boolean(v)} onChange={(e) => set(f.key, e.target.checked)} label={f.label} />
                  {f.hint && <p className="ml-6 mt-1 text-xs leading-relaxed text-navy-500">{f.hint}</p>}
                </div>
              );
            }
            const wide = ("wide" in f && f.wide) || f.type === "textarea" || f.type === "list";
            return (
              <Field key={f.key} label={f.label} htmlFor={id} hint={f.hint} className={wide ? "sm:col-span-2" : undefined}>
                {f.type === "textarea" ? (
                  <Textarea id={id} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value)} />
                ) : f.type === "list" ? (
                  <Textarea id={id} value={((v as string[]) ?? []).join("\n")} onChange={(e) => set(f.key, e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} rows={4} />
                ) : f.type === "select" ? (
                  <Select id={id} value={String(v ?? "")} onChange={(e) => set(f.key, f.numeric ? Number(e.target.value) : e.target.value)}>
                    {f.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ) : f.type === "number" ? (
                  <Input id={id} type="number" min={f.min} max={f.max} value={String(v ?? "")} onChange={(e) => set(f.key, e.target.value === "" ? "" : Number(e.target.value))} />
                ) : (
                  <Input
                    id={id}
                    type={f.type === "email" ? "email" : f.type === "url" ? "url" : "text"}
                    inputMode={f.type === "decimal" ? "decimal" : undefined}
                    placeholder={"placeholder" in f ? f.placeholder : undefined}
                    value={String(v ?? "")}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </Field>
            );
          })}
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-navy-100 pt-4 sm:col-span-2">
            {extra > 0 && (
              <button type="button" onClick={() => setMore((m) => !m)} className="mr-auto text-sm font-semibold text-navy-600 underline underline-offset-[3px] hover:text-navy-950" aria-expanded={more}>
                {more ? "Fewer settings" : `More settings (${extra})`}
              </button>
            )}
            <Button variant="outline" onClick={() => setForm(value)}>
              Reset
            </Button>
            <Button type="submit" loading={busy}>
              Save {spec.title.toLowerCase()}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** Cards the owner rarely needs (bill numbering, GST rate classes), closed until asked for. */
function MoreCards({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <>{children}</>
  ) : (
    <button type="button" onClick={() => setOpen(true)} className="text-sm font-semibold text-navy-600 underline underline-offset-[3px] hover:text-navy-950">
      Show {label.toLowerCase()} (advanced)
    </button>
  );
}

function RegistrationCard({ current, gstin, all }: { current: Settings["tax"]["registrationType"]; gstin: string; all: Settings["tax"] }) {
  const [choice, setChoice] = useState<string>(current ?? "");
  const { save, busy, error } = useSave("tax");
  const options = [
    { value: "regular", title: "Regular GST registration", body: "Issues GST Tax Invoices with CGST/SGST (or IGST). Bills of Supply for exempt-only sales; Invoice-cum-Bill of Supply for mixed sales to unregistered buyers. Requires the shop GSTIN." },
    { value: "composition", title: "Composition scheme", body: "Issues Bills of Supply headed “Composition taxable person, not eligible to collect tax on supplies”. No GST is charged to customers; inter-state sales are blocked." },
    { value: "unregistered", title: "Not registered for GST", body: "Issues a simple Cash Memo with no GST. GST must not be collected." },
    { value: "", title: "Not confirmed yet", body: "Real bills are blocked. Only training (sample) sales can be completed." },
  ];
  return (
    <Card>
      <CardHeader title="GST registration type" description="The single most important tax setting. Changing it affects every new bill (existing bills never change)." actions={current ? <Badge tone="green">Configured</Badge> : <Badge tone="amber">Not confirmed</Badge>} />
      <CardBody className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        {choice === "regular" && !gstin && <Alert tone="warning">Enter the shop GSTIN under Business details before issuing tax invoices.</Alert>}
        <div className="grid gap-3 md:grid-cols-2">
          {options.map((o) => (
            <label
              key={o.value || "none"}
              className={cn(
                "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-gold-600",
                choice === o.value ? "border-navy-900 bg-paper/60 shadow-[inset_3px_0_0_var(--color-gold-500)]" : "border-navy-200 bg-white hover:border-navy-400",
              )}
            >
              <input type="radio" name="regType" className="sr-only" checked={choice === o.value} onChange={() => setChoice(o.value)} />
              <span aria-hidden className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", choice === o.value ? "border-navy-900" : "border-navy-300")}>
                {choice === o.value && <span className="h-2 w-2 rounded-full bg-navy-900" />}
              </span>
              <span>
                <span className="block font-semibold text-navy-950">{o.title}</span>
                <span className="mt-1 block text-xs leading-relaxed text-navy-600">{o.body}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <Button
            loading={busy}
            disabled={choice === (current ?? "")}
            onClick={() => {
              if (confirm("Confirm the GST registration type? This changes how every new bill is issued. Make sure your accountant agrees.")) {
                save({ ...all, registrationType: choice || null });
              }
            }}
          >
            Save registration type
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function PrefixesForm({ value, fy }: { value: Settings["documents"]; fy: string }) {
  const [p, setP] = useState(value.prefixes);
  const { save, busy, error } = useSave("documents");
  const labels: Record<keyof typeof p, string> = {
    tax_invoice: "Tax invoice",
    bill_of_supply: "Bill of supply",
    cash_memo: "Cash memo",
    credit_note: "Credit note",
    quotation: "Quotation",
    training: "Training (sample) documents",
  };
  return (
    <Card>
      <CardHeader title="Document numbering" description="Numbers restart every financial year (1 April) and are never reused. Format: PREFIX/YY-YY/00001 (max 16 characters)." />
      <CardBody>
        {error && <Alert tone="danger" className="mb-3">{error}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          {(Object.keys(p) as (keyof typeof p)[]).map((k) => (
            <Field key={k} label={labels[k]} hint={`e.g. ${p[k] || "?"}/${fy}/00001`}>
              <Input value={p[k]} maxLength={4} onChange={(e) => setP({ ...p, [k]: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} className="tabular" />
            </Field>
          ))}
        </div>
        <Alert tone="warning" className="mt-4">
          Changing a prefix mid-year starts a new series. Agree prefixes with your accountant before issuing real bills.
        </Alert>
        <div className="mt-4 flex justify-end">
          <Button loading={busy} onClick={() => save({ ...value, prefixes: p })}>
            Save numbering
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function TaxClasses({ classes, canEdit }: { classes: TaxClass[]; canEdit: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [f, setF] = useState({ name: "", gstRate: "", cessRate: "0", description: "" });
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await apiFetch("/api/admin/tax-classes", { method: "POST", body: { ...f, description: f.description || null } });
      toast("Tax class added");
      setF({ name: "", gstRate: "", cessRate: "0", description: "" });
      router.refresh();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="GST rate classes" description="Assigned to products. Confirm each product's HSN and rate against current CBIC notifications with your accountant." />
      <CardBody className="space-y-4">
        <ul className="divide-y divide-navy-100 rounded-lg border border-navy-100">
          {classes.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div>
                <div className="font-semibold">{t.name}</div>
                {t.description && <div className="mt-0.5 text-xs text-navy-500">{t.description}</div>}
              </div>
              <div className="whitespace-nowrap tabular text-[13px] font-semibold">
                {Number(t.gstRate)}%{Number(t.cessRate) ? ` + ${Number(t.cessRate)}% cess` : ""}
              </div>
            </li>
          ))}
        </ul>
        {canEdit && (
          <div className="grid gap-3 sm:grid-cols-[1fr_120px_120px_auto] sm:items-end">
            <Field label="Name">
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. GST 40%" />
            </Field>
            <Field label="GST %">
              <Input value={f.gstRate} onChange={(e) => setF({ ...f, gstRate: e.target.value })} inputMode="decimal" className="tabular" />
            </Field>
            <Field label="Cess %">
              <Input value={f.cessRate} onChange={(e) => setF({ ...f, cessRate: e.target.value })} inputMode="decimal" className="tabular" />
            </Field>
            <Button onClick={add} loading={busy} disabled={!f.name || !f.gstRate}>
              Add
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
