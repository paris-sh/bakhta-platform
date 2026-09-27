"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { clearPendingLoginEmail, peekPendingLoginEmail } from "@/lib/pending-login";
import { AuthShell } from "@/components/AuthShell";
import { ErrorMessage, Notice } from "@/components/StatusMessage";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t, errorText } = useI18n();
  // Prefilled only when arriving straight from registration (in memory, never via the URL).
  const [email, setEmail] = useState(peekPendingLoginEmail);
  const [justRegistered] = useState(() => peekPendingLoginEmail() !== "");
  useEffect(clearPendingLoginEmail, []);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await api.login(email, password);
      await login(session.token);
      router.push("/");
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell
      title={t.auth.loginTitle}
      subtitle={t.auth.loginSubtitle}
      footer={
        <>
          {t.auth.noAccount}{" "}
          <Link href="/register" className="font-semibold text-brand underline-offset-4 hover:underline">
            {t.auth.registerLink}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {justRegistered && <Notice tone="success">{t.auth.registeredPleaseLogin}</Notice>}
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
            autoComplete="current-password"
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
          />
        </div>

        {error !== null && <ErrorMessage message={errorText(error)} />}

        <button type="submit" disabled={submitting} className="btn btn-primary btn-lg mt-1 w-full">
          {submitting ? t.auth.signingIn : t.auth.signIn}
        </button>
      </form>
    </AuthShell>
  );
}
