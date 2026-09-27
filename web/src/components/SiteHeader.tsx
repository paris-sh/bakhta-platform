"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n/locale-context";
import { LogoMark } from "./brand";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { CloseIcon, LogoutIcon, MenuIcon, SearchIcon, UserIcon } from "./icons";

export function Wordmark() {
  const { t } = useI18n();
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark size={36} />
      <span className="flex flex-col leading-none">
        <span className="text-lg font-extrabold tracking-tight text-foreground">{t.brand.name}</span>
        <span className="mt-1 text-[0.68rem] font-semibold tracking-wide text-gold-700">{t.brand.tagline}</span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  const { user, isLoading, logout } = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    setMenuOpen(false);
    router.push("/");
  }

  const linkCls = (href: string) =>
    `focus-ring flex min-h-11 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-colors duration-200 ${
      pathname === href ? "bg-brand-50 text-brand-700" : "text-ink-soft hover:bg-background-subtle hover:text-foreground"
    }`;
  const close = () => setMenuOpen(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border/80 bg-surface/85 backdrop-blur-md supports-[backdrop-filter]:bg-surface/75">
      <div className="container-page flex h-16 items-center gap-3">
        <Link href="/" className="focus-ring -mx-1 rounded-md px-1" aria-label={t.nav.home} onClick={close}>
          <Wordmark />
        </Link>

        <nav
          id="primary-nav"
          aria-label={t.nav.primary}
          className={`${menuOpen ? "flex" : "hidden"} absolute inset-x-0 top-full flex-col gap-1 border-b border-border bg-surface p-3 shadow-md md:static md:ms-auto md:flex md:flex-row md:items-center md:gap-1 md:border-0 md:bg-transparent md:p-0 md:shadow-none`}
        >
          <Link href="/results" className={linkCls("/results")} onClick={close}>
            {t.nav.results}
          </Link>
          <Link href="/tickets/check" className={linkCls("/tickets/check")} onClick={close}>
            <SearchIcon className="h-4 w-4" />
            {t.nav.checkTicket}
          </Link>

          {isLoading ? null : user ? (
            <>
              <Link href="/account/orders" className={linkCls("/account/orders")} onClick={close}>
                {t.nav.myOrders}
              </Link>
              <Link href="/account/tickets" className={linkCls("/account/tickets")} onClick={close}>
                {t.nav.myTickets}
              </Link>
              <span
                className="hidden max-w-48 items-center gap-1.5 truncate px-2 text-xs text-muted lg:flex"
                dir="ltr"
                title={user.email}
              >
                <UserIcon className="h-4 w-4 shrink-0" />
                <span className="truncate">{user.email}</span>
              </span>
              <button
                type="button"
                onClick={handleLogout}
                className="focus-ring flex min-h-11 items-center gap-2 rounded-md px-3 text-start text-sm font-semibold text-danger transition-colors duration-200 hover:bg-danger-bg"
              >
                <LogoutIcon className="h-4 w-4" />
                {t.nav.logout}
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className={linkCls("/login")} onClick={close}>
                {t.nav.login}
              </Link>
              <Link href="/register" className="btn btn-primary btn-sm md:ms-1" onClick={close}>
                {t.nav.register}
              </Link>
            </>
          )}
        </nav>

        <div className="ms-auto flex items-center gap-2 md:ms-2">
          <LanguageSwitcher />
          <button
            type="button"
            className="btn btn-secondary btn-sm px-2.5 md:hidden"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-controls="primary-nav"
            aria-label={menuOpen ? t.nav.closeMenu : t.nav.menu}
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </div>
    </header>
  );
}
