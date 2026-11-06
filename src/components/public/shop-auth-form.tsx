"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { normalizeMobile } from "@/lib/india";

/** Only same-site paths may be the place to return to after signing in. */
function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/my-orders";
}

export function ShopAuthForm({ mode, next }: { mode: "sign-in" | "sign-up"; next?: string | null }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", mobile: "", password: "", email: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const target = safeNext(next);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (mode === "sign-up" && form.name.trim().length < 2) errs.name = "Please enter your name";
    if (!normalizeMobile(form.mobile)) errs.mobile = "Enter your 10-digit mobile number";
    if (mode === "sign-up" && form.password.length < 8) errs.password = "Use at least 8 characters";
    if (mode === "sign-in" && !form.password) errs.password = "Enter your password";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError(null);
    try {
      await apiFetch(mode === "sign-up" ? "/api/shop/auth/signup" : "/api/shop/auth/signin", {
        body: mode === "sign-up" ? { name: form.name.trim(), mobile: form.mobile.trim(), password: form.password, email: form.email.trim() || null } : { mobile: form.mobile.trim(), password: form.password },
      });
      router.replace(target);
      router.refresh();
    } catch (err) {
      setServerError(errorMessage(err));
      setBusy(false);
    }
  };

  const other = mode === "sign-in" ? "/sign-up" : "/sign-in";
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {serverError && <Alert tone="danger">{serverError}</Alert>}
      {mode === "sign-up" && (
        <Field label="Your name" htmlFor="sh-name" required error={errors.name}>
          <Input id="sh-name" autoComplete="name" value={form.name} onChange={set("name")} />
        </Field>
      )}
      <Field label="Mobile number" htmlFor="sh-mobile" required error={errors.mobile}>
        <Input id="sh-mobile" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98250 12345" value={form.mobile} onChange={set("mobile")} />
      </Field>
      <Field label="Password" htmlFor="sh-password" required error={errors.password} hint={mode === "sign-up" ? "At least 8 characters." : undefined}>
        <Input id="sh-password" type="password" autoComplete={mode === "sign-up" ? "new-password" : "current-password"} value={form.password} onChange={set("password")} />
      </Field>
      {mode === "sign-up" && (
        <Field label="Email (optional)" htmlFor="sh-email">
          <Input id="sh-email" type="email" autoComplete="email" value={form.email} onChange={set("email")} />
        </Field>
      )}
      <Button type="submit" loading={busy} className="h-12 w-full text-[15px]">
        {mode === "sign-up" ? "Create account" : "Sign in"}
      </Button>
      {mode === "sign-up" && (
        <p className="text-center text-xs leading-relaxed text-navy-500">
          By creating an account you agree to our{" "}
          <Link href="/terms" className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-950">terms of use</Link> and{" "}
          <Link href="/privacy" className="font-medium text-navy-700 underline underline-offset-2 hover:text-navy-950">privacy policy</Link>.
        </p>
      )}
      <p className="text-center text-sm text-navy-500">
        {mode === "sign-in" ? "New here? " : "Already have an account? "}
        <Link href={next ? `${other}?next=${encodeURIComponent(target)}` : other} className="link-draw font-semibold text-navy-950">
          {mode === "sign-in" ? "Create an account" : "Sign in"}
        </Link>
      </p>
      {mode === "sign-in" && <p className="text-center text-xs text-navy-500">Forgot your password? Call or WhatsApp the shop and we&apos;ll reset it.</p>}
    </form>
  );
}
