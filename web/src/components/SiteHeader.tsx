"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";

export function SiteHeader() {
  const { user, isLoading, logout } = useAuth();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    setMenuOpen(false);
    router.push("/");
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 focus-ring rounded-md">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-brand-contrast font-bold">
            ب
          </span>
          <span className="text-lg font-extrabold text-foreground">بخت‌آ</span>
        </Link>

        <button
          type="button"
          className="sm:hidden focus-ring rounded-md border border-border px-3 py-1.5 text-sm"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="primary-nav"
        >
          منو
        </button>

        <nav
          id="primary-nav"
          className={`${menuOpen ? "flex" : "hidden"} sm:flex absolute sm:static inset-x-0 top-full sm:top-auto flex-col sm:flex-row gap-1 sm:gap-2 border-b sm:border-none border-border bg-surface sm:bg-transparent p-4 sm:p-0 items-stretch sm:items-center text-sm font-medium`}
        >
          <Link
            href="/tickets/check"
            className="focus-ring rounded-md px-3 py-2 hover:bg-background"
            onClick={() => setMenuOpen(false)}
          >
            بررسی بلیط
          </Link>

          {isLoading ? null : user ? (
            <>
              <Link
                href="/account/orders"
                className="focus-ring rounded-md px-3 py-2 hover:bg-background"
                onClick={() => setMenuOpen(false)}
              >
                سفارش‌های من
              </Link>
              <Link
                href="/account/tickets"
                className="focus-ring rounded-md px-3 py-2 hover:bg-background"
                onClick={() => setMenuOpen(false)}
              >
                بلیط‌های من
              </Link>
              <span className="px-3 py-2 text-muted hidden sm:inline">{user.email}</span>
              <button
                type="button"
                onClick={handleLogout}
                className="focus-ring rounded-md px-3 py-2 text-right hover:bg-background text-danger"
              >
                خروج
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="focus-ring rounded-md px-3 py-2 hover:bg-background"
                onClick={() => setMenuOpen(false)}
              >
                ورود
              </Link>
              <Link
                href="/register"
                className="focus-ring rounded-md bg-brand px-3 py-2 text-brand-contrast hover:bg-brand-dark"
                onClick={() => setMenuOpen(false)}
              >
                ثبت‌نام
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
