"use client";
import { useEffect, useState } from "react";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { apiFetch, errorMessage } from "@/lib/api-client";
import { isValidEmail } from "@/lib/india";

/**
 * "Send me a code" and the box to type it in, for proving an email address. The parent keeps the email and
 * the code; this handles asking for the code (with a short wait before asking again) and says where it went.
 */
export function EmailCodeInput({
  email,
  sendPath,
  code,
  onCodeChange,
  error,
}: {
  email: string;
  /** The API route that emails the code. */
  sendPath: string;
  code: string;
  onCodeChange: (v: string) => void;
  error?: string;
}) {
  const clean = email.trim().toLowerCase();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // A different address needs its own code.
  const sent = sentTo === clean;

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await apiFetch<{ cooldownSeconds: number }>(sendPath, { body: { email: clean } });
      setSentTo(clean);
      setWait(r.cooldownSeconds);
      onCodeChange("");
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const valid = isValidEmail(clean);
  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" loading={busy} disabled={!valid || wait > 0} onClick={send} className="h-11 w-full">
        {wait > 0 ? `Send again in ${wait}s` : sent ? "Send the code again" : "Send me a code"}
      </Button>
      {problem && <Alert tone="danger">{problem}</Alert>}
      {/* Pressing "Create account" before asking for a code: say what to do, since the code box isn't there yet. */}
      {!sent && error && <p role="alert" className="text-[13px] text-red-700">{valid ? "Tap “Send me a code” first, then type the code we email you." : error}</p>}
      {sent && (
        <>
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-[13px] leading-relaxed text-emerald-900">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              We emailed a 6-digit code to <strong className="break-all">{clean}</strong>. It works for 10 minutes. If you can&apos;t see it, check your spam folder.
            </span>
          </div>
          <Field label="Code from the email" htmlFor="sh-code" required error={error}>
            <Input
              id="sh-code"
              value={code}
              onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={6}
              className="h-12 text-center text-xl font-semibold tracking-[0.5em] tabular"
            />
          </Field>
        </>
      )}
    </div>
  );
}
