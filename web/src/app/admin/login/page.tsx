"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { CloverPattern, Glow, GLOW, LogoMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ErrorMessage, Notice } from "@/components/StatusMessage";
import { ShieldIcon } from "@/components/icons";

/** Only same-site admin paths may be used as a post-login destination. */
function safeNext(value: string | null): string {
  return value && value.startsWith("/admin") && !value.startsWith("//") && !value.startsWith("/admin/login") ? value : "/admin";
}

function AdminLoginForm() {
  const { status, login } = useAdminAuth();
  const { a, errorText } = useAdminI18n();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const expired = params.get("expired") === "1";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace(next);
  }, [status, next, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      router.replace(next);
    } catch (err) {
      setError(err);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      {expired && error === null && <Notice tone="info">{a.login.expired}</Notice>}
      <div>
        <label htmlFor="admin-email" className="field-label">
          {a.login.email}
        </label>
        <input
          id="admin-email"
          type="email"
          autoComplete="username"
          dir="ltr"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input"
        />
      </div>
      <div>
        <label htmlFor="admin-password" className="field-label">
          {a.login.password}
        </label>
        <input
          id="admin-password"
          type="password"
          autoComplete="current-password"
          dir="ltr"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input"
        />
      </div>
      {error !== null && <ErrorMessage message={errorText(error)} />}
      <button type="submit" className="btn btn-primary btn-lg mt-1 w-full" disabled={submitting || !email || !password}>
        {submitting ? a.login.submitting : a.login.submit}
      </button>
    </form>
  );
}

export default function AdminLoginPage() {
  const { a } = useAdminI18n();
  return (
    <div className="relative isolate flex min-h-screen flex-1 items-center justify-center overflow-hidden bg-[linear-gradient(150deg,var(--brand-800)_0%,var(--brand-900)_55%,#021a12_100%)] px-4 py-10">
      <CloverPattern opacity={0.06} />
      <Glow className="-end-40 -top-48 h-[40rem] w-[40rem]" color={GLOW.gold} />
      <div className="absolute end-4 top-4" style={{ top: "calc(env(safe-area-inset-top, 0px) + 1rem)" }}>
        <LanguageSwitcher tone="dark" />
      </div>
      <div className="animate-fade-up relative w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center text-white">
          <LogoMark size={52} />
          <p className="mt-3 text-xs font-bold uppercase tracking-[0.2em] text-gold-300">{a.brand.console}</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-surface p-6 shadow-lg sm:p-7">
          <h1 className="text-xl font-extrabold tracking-tight">{a.login.title}</h1>
          <p className="mt-1 text-sm text-muted">{a.login.subtitle}</p>
          <div className="mt-5">
            <Suspense fallback={null}>
              <AdminLoginForm />
            </Suspense>
          </div>
        </div>
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-white/60">
          <ShieldIcon className="h-4 w-4" />
          {a.login.separate}
        </p>
      </div>
    </div>
  );
}
