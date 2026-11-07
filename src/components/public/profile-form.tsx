"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BadgeCheck, KeyRound, MailWarning, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { ApiError, apiFetch, errorMessage } from "@/lib/api-client";
import { STATES, formatPhone, isValidEmail } from "@/lib/india";
import type { ShopProfileFields } from "@/lib/shop-profile";
import { EmailCodeInput } from "./email-code-input";

export interface ProfileView extends ShopProfileFields {
  name: string;
  mobile: string;
  email: string | null;
  emailVerified: boolean;
  memberSince: string;
  profileUpdatedAt: string | null;
}

type FormState = Record<"name" | keyof ShopProfileFields, string>;

const toForm = (p: ProfileView): FormState => ({
  name: p.name,
  businessName: p.businessName ?? "",
  gstin: p.gstin ?? "",
  altMobile: p.altMobile ?? "",
  addressLine1: p.addressLine1 ?? "",
  addressLine2: p.addressLine2 ?? "",
  landmark: p.landmark ?? "",
  city: p.city ?? "",
  state: p.state ?? "",
  pincode: p.pincode ?? "",
});

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-navy-200 bg-white">
      <div className="border-b border-navy-100 px-5 py-4">
        <h2 className="font-semibold text-navy-950">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-navy-500">{description}</p>}
      </div>
      <div className="space-y-4 px-5 py-5">{children}</div>
    </section>
  );
}

/** My profile: details the shop prints on the customer's receipts and sees with their orders. */
export function ProfileForm({ profile }: { profile: ProfileView }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => toForm(profile));
  // What is saved (tidied by the server: "98250 11111" comes back as 9825011111), to tell unsaved changes apart.
  const [base, setBase] = useState<FormState>(() => toForm(profile));
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(form) !== JSON.stringify(base);
  const set = (k: keyof FormState, tidy: (v: string) => string = (v) => v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = tidy(e.target.value);
    setForm((f) => ({ ...f, [k]: value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
    setSaved(false);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) return setErrors({ name: "Please enter your name" });
    setBusy(true);
    setProblem(null);
    setErrors({});
    try {
      const r = await apiFetch<{ profile: ProfileView }>("/api/shop/account/profile", { method: "PATCH", body: Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim() || null])) });
      const savedForm = toForm({ ...profile, ...r.profile });
      setForm(savedForm);
      setBase(savedForm);
      setSaved(true);
      router.refresh();
    } catch (err) {
      const field = err instanceof ApiError ? (err.details?.field as keyof FormState | undefined) : undefined;
      if (field && field in form) {
        setErrors({ [field]: errorMessage(err) });
        document.getElementById(`pf-${field}`)?.focus();
      } else setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={save} noValidate className="space-y-6">
        <Section title="Your details" description="Your mobile number is how you sign in, so it stays as it is. To use a different one, make a new account or ask the shop.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" htmlFor="pf-name" required error={errors.name}>
              <Input id="pf-name" autoComplete="name" value={form.name} onChange={set("name")} maxLength={80} />
            </Field>
            <Field label="Mobile (sign-in)" htmlFor="pf-mobile">
              <Input id="pf-mobile" value={formatPhone(profile.mobile)} readOnly disabled className="tabular" />
            </Field>
            <Field label="Other phone (optional)" htmlFor="pf-altMobile" hint="Someone we can call if you can't be reached." error={errors.altMobile}>
              <Input id="pf-altMobile" type="tel" inputMode="tel" autoComplete="tel" value={form.altMobile} onChange={set("altMobile")} maxLength={15} className="tabular" />
            </Field>
          </div>
        </Section>

        <Section title="Business (optional)" description="Buying for a business? Add its name and GSTIN, and we print them on your receipt and on the GST bill at the counter.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" htmlFor="pf-businessName" error={errors.businessName}>
              <Input id="pf-businessName" autoComplete="organization" value={form.businessName} onChange={set("businessName")} maxLength={120} />
            </Field>
            <Field label="GSTIN" htmlFor="pf-gstin" hint="15 characters, e.g. 24ABCDE1234F1Z5" error={errors.gstin}>
              <Input id="pf-gstin" value={form.gstin} onChange={set("gstin", (v) => v.toUpperCase().replace(/\s/g, ""))} maxLength={15} className="tabular uppercase" autoCapitalize="characters" spellCheck={false} />
            </Field>
          </div>
        </Section>

        <Section title="Address" description="Your billing address. Orders are still collected from the shop; for delivery of large orders we use this address when we call you.">
          <Field label="House / shop number and street" htmlFor="pf-addressLine1" error={errors.addressLine1}>
            <Input id="pf-addressLine1" autoComplete="address-line1" value={form.addressLine1} onChange={set("addressLine1")} maxLength={150} />
          </Field>
          <Field label="Area, colony or village (optional)" htmlFor="pf-addressLine2" error={errors.addressLine2}>
            <Input id="pf-addressLine2" autoComplete="address-line2" value={form.addressLine2} onChange={set("addressLine2")} maxLength={150} />
          </Field>
          <Field label="Landmark (optional)" htmlFor="pf-landmark" error={errors.landmark}>
            <Input id="pf-landmark" value={form.landmark} onChange={set("landmark")} maxLength={100} placeholder="e.g. opposite the bus stand" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Town / city" htmlFor="pf-city" error={errors.city}>
              <Input id="pf-city" autoComplete="address-level2" value={form.city} onChange={set("city")} maxLength={60} />
            </Field>
            <Field label="State" htmlFor="pf-state" error={errors.state}>
              <Select id="pf-state" autoComplete="address-level1" value={form.state} onChange={set("state")}>
                <option value="">Choose…</option>
                {STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="PIN code" htmlFor="pf-pincode" error={errors.pincode}>
              <Input id="pf-pincode" inputMode="numeric" autoComplete="postal-code" value={form.pincode} onChange={set("pincode")} maxLength={6} className="tabular" />
            </Field>
          </div>
        </Section>

        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-navy-200 bg-white/95 px-4 py-3 shadow-card backdrop-blur">
          <div className="min-w-0 text-[13px]" role="status" aria-live="polite">
            {problem ? (
              <span className="text-red-700">{problem}</span>
            ) : saved && !dirty ? (
              <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                <BadgeCheck className="h-4 w-4" /> Saved. Your next receipts use these details.
              </span>
            ) : dirty ? (
              <span className="text-navy-600">You have unsaved changes.</span>
            ) : (
              <span className="text-navy-500">{profile.profileUpdatedAt ? `Last updated ${new Date(profile.profileUpdatedAt).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" })}` : "Fill in what applies to you, then save."}</span>
            )}
          </div>
          <Button type="submit" loading={busy} disabled={!dirty} icon={<Save className="h-4 w-4" />}>
            Save profile
          </Button>
        </div>
      </form>

      <EmailSection email={profile.email} verified={profile.emailVerified} />
      <PasswordSection />
    </div>
  );
}

function EmailSection({ email, verified }: { email: string | null; verified: boolean }) {
  const router = useRouter();
  const [changing, setChanging] = useState(!email || !verified);
  const [next, setNext] = useState(verified ? "" : (email ?? ""));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const confirm = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await apiFetch("/api/shop/account/verify-email", { body: { email: next.trim(), code } });
      setDone(true);
      setChanging(false);
      setCode("");
      router.refresh();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Email" description="Order updates and your sign-up code come here. A new address is used once you enter the code we email to it.">
      {email ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="break-all font-medium text-navy-950">{email}</div>
            <div className={`mt-0.5 inline-flex items-center gap-1.5 text-[13px] ${verified ? "text-emerald-700" : "text-amber-700"}`}>
              {verified ? <BadgeCheck className="h-4 w-4" /> : <MailWarning className="h-4 w-4" />}
              {verified ? (done ? "Verified just now" : "Verified") : "Not verified yet"}
            </div>
          </div>
          {!changing && (
            <Button variant="outline" size="sm" onClick={() => setChanging(true)}>
              Change email
            </Button>
          )}
        </div>
      ) : (
        <p className="text-sm text-navy-600">No email on your account yet.</p>
      )}
      {changing && (
        <div className="space-y-3 rounded-lg border border-navy-100 bg-paper/50 p-4">
          <Field label={email && verified ? "New email" : "Email"} htmlFor="pf-email">
            <Input id="pf-email" type="email" autoComplete="email" value={next} onChange={(e) => setNext(e.target.value)} maxLength={120} />
          </Field>
          <EmailCodeInput email={next} sendPath="/api/shop/account/email-code" code={code} onCodeChange={setCode} />
          {problem && <Alert tone="danger">{problem}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button loading={busy} disabled={!isValidEmail(next.trim()) || !/^\d{6}$/.test(code)} onClick={confirm}>
              Verify email
            </Button>
            {email && verified && (
              <Button variant="ghost" onClick={() => setChanging(false)} disabled={busy}>
                Keep {email}
              </Button>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}

function PasswordSection() {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [errors, setErrors] = useState<Partial<Record<"current" | "next" | "again", string>>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!f.current) errs.current = "Enter your current password";
    if (f.next.length < 8) errs.next = "Use at least 8 characters";
    else if (f.next !== f.again) errs.again = "The two new passwords don't match";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setProblem(null);
    setDone(false);
    try {
      await apiFetch("/api/shop/account/password", { body: { current: f.current, next: f.next } });
      setDone(true);
      setF({ current: "", next: "", again: "" });
    } catch (err) {
      const field = err instanceof ApiError ? (err.details?.field as "current" | "next" | undefined) : undefined;
      if (field) setErrors({ [field]: errorMessage(err) });
      else setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Section title="Password" description="Changing it signs you out on your other phones and computers. This one stays signed in.">
      <form onSubmit={submit} noValidate className="space-y-4">
        {done && <Alert tone="success">Password changed. Other devices have been signed out.</Alert>}
        {problem && <Alert tone="danger">{problem}</Alert>}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Current password" htmlFor="pw-current" error={errors.current}>
            <Input id="pw-current" type="password" autoComplete="current-password" value={f.current} onChange={set("current")} />
          </Field>
          <Field label="New password" htmlFor="pw-next" error={errors.next}>
            <Input id="pw-next" type="password" autoComplete="new-password" value={f.next} onChange={set("next")} />
          </Field>
          <Field label="New password again" htmlFor="pw-again" error={errors.again}>
            <Input id="pw-again" type="password" autoComplete="new-password" value={f.again} onChange={set("again")} />
          </Field>
        </div>
        <Button type="submit" variant="outline" loading={busy} icon={<KeyRound className="h-4 w-4" />}>
          Change password
        </Button>
      </form>
    </Section>
  );
}
