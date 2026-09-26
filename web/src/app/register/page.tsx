"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, api } from "@/lib/api-client";
import { ErrorMessage } from "@/components/StatusMessage";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("رمز عبور باید حداقل ۱۰ نویسه باشد.");
      return;
    }
    setSubmitting(true);
    try {
      await api.register(email, password);
      setDone(true);
      setTimeout(() => router.push(`/login?email=${encodeURIComponent(email)}`), 1200);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ثبت‌نام با خطا مواجه شد.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:px-6">
      <h1 className="mb-6 text-2xl font-extrabold">ثبت‌نام</h1>

      {done ? (
        <p className="rounded-lg bg-success-bg p-4 text-success">
          ثبت‌نام موفق بود. در حال انتقال به صفحه ورود...
        </p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">
              ایمیل
            </label>
            <input
              id="email"
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium">
              رمز عبور (حداقل ۱۰ نویسه)
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={10}
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </div>

          {error && <ErrorMessage message={error} />}

          <button
            type="submit"
            disabled={submitting}
            className="focus-ring rounded-lg bg-brand px-4 py-3 font-bold text-brand-contrast hover:bg-brand-dark disabled:opacity-50"
          >
            {submitting ? "در حال ثبت‌نام..." : "ثبت‌نام"}
          </button>

          <p className="text-center text-sm text-muted">
            حساب دارید؟{" "}
            <Link href="/login" className="text-brand underline">
              وارد شوید
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
