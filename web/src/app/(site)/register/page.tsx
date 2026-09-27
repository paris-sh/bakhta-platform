"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { setPendingLoginEmail } from "@/lib/pending-login";
import { AuthShell } from "@/components/AuthShell";
import { ErrorMessage, Notice } from "@/components/StatusMessage";

type RegisterError = { kind: "tooShort" } | { kind: "api"; error: unknown };

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t, errorText } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<RegisterError | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError({ kind: "tooShort" });
      return;
    }
    setSubmitting(true);
    try {
      await api.register(email, password);
    } catch (err) {
      setError({ kind: "api", error: err });
      setSubmitting(false);
      return;
    }

    setDone(true);
    // Sign straight in with the credentials just entered — nothing is stored or put in a
    // URL. If that fails for any reason, fall back to the login page with the email
    // prefilled from memory.
    try {
      const session = await api.login(email, password);
      await login(session.token);
      router.push("/");
    } catch {
      setPendingLoginEmail(email);
      router.push("/login");
    }
  }

  return (
    <AuthShell
      title={t.auth.registerTitle}
      subtitle={t.auth.registerSubtitle}
      footer={
        <>
          {t.auth.haveAccount}{" "}
          <Link href="/login" className="font-semibold text-brand underline-offset-4 hover:underline">
            {t.auth.loginLink}
          </Link>
        </>
      }
    >
      {done ? (
        <Notice tone="success">{t.auth.registeredSigningIn}</Notice>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="email" className="field-label">
              {t.auth.email}
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="password" className="field-label">
              {t.auth.password}
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={10}
              autoComplete="new-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              aria-invalid={error?.kind === "tooShort"}
              aria-describedby="password-hint"
            />
            <p id="password-hint" className="field-hint">
              {t.auth.passwordHint}
            </p>
          </div>

          {error && (
            <ErrorMessage message={error.kind === "tooShort" ? t.auth.passwordTooShort : errorText(error.error)} />
          )}

          <button type="submit" disabled={submitting} className="btn btn-primary btn-lg mt-1 w-full">
            {submitting ? t.auth.creatingAccount : t.auth.createAccount}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
