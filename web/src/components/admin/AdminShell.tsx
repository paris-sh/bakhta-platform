"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import type { AdminPermission } from "@/lib/admin/types";
import { LogoMark } from "@/components/brand";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { CalendarIcon, CloseIcon, LogoutIcon, MenuIcon, ShieldIcon, UserIcon } from "@/components/icons";

// ---------------------------------------------------------------- icons (24px, stroke)

function Svg({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
const DashboardIcon = () => (
  <Svg>
    <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
    <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
    <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
  </Svg>
);
const GamesIcon = () => (
  <Svg>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);
const OrdersIcon = () => (
  <Svg>
    <path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </Svg>
);
const ResultsIcon = () => (
  <Svg>
    <path d="M8 4h8v5a4 4 0 0 1-8 0z" />
    <path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6" />
  </Svg>
);
const ChevronIcon = ({ flip }: { flip?: boolean }) => (
  <Svg className={`h-4 w-4 ${flip ? "rotate-180" : ""} rtl:-scale-x-100`}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);

// ---------------------------------------------------------------- breadcrumbs

export type Crumb = { label: string; href?: string };
const CrumbContext = createContext<(crumbs: Crumb[]) => void>(() => undefined);

/** Pages declare their breadcrumb trail (after "Admin") with this hook. */
export function useBreadcrumbs(crumbs: Crumb[]) {
  const set = useContext(CrumbContext);
  const key = JSON.stringify(crumbs);
  useEffect(() => {
    set(JSON.parse(key) as Crumb[]);
  }, [key, set]);
}

// ---------------------------------------------------------------- nav

type NavItem = { href: string; label: string; icon: ReactNode; permission: AdminPermission };

export function useAdminNav(): NavItem[] {
  const { a } = useAdminI18n();
  return [
    { href: "/admin", label: a.nav.dashboard, icon: <DashboardIcon />, permission: "dashboard.view" },
    { href: "/admin/games", label: a.nav.games, icon: <GamesIcon />, permission: "games.view" },
    { href: "/admin/draws", label: a.nav.draws, icon: <CalendarIcon />, permission: "draws.view" },
    { href: "/admin/results", label: a.nav.results, icon: <ResultsIcon />, permission: "results.view" },
    { href: "/admin/orders", label: a.nav.orders, icon: <OrdersIcon />, permission: "orders.view" },
    { href: "/admin/audit", label: a.nav.audit, icon: <ShieldIcon />, permission: "audit.view" },
  ];
}

const COLLAPSE_KEY = "bakhta.admin.sidebar_collapsed";

export function AdminShell({ children }: { children: ReactNode }) {
  const { me, can, logout } = useAdminAuth();
  const { a } = useAdminI18n();
  const pathname = usePathname();
  const nav = useAdminNav().filter((item) => can(item.permission));
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);

  // Per-viewer convenience only.
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === "1") Promise.resolve().then(() => setCollapsed(true));
    } catch {
      /* storage unavailable */
    }
  }, []);
  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  }
  useEffect(() => {
    Promise.resolve().then(() => setDrawer(false));
  }, [pathname]);

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  const role = me?.roles[0];
  const roleLabel = role ? (a.top.roles[role] ?? role) : a.top.noRole;

  // Plain render helpers (not components) so the sidebar never remounts between renders.
  const navLinks = (compact: boolean) => (
      <ul className="flex flex-col gap-1">
        {nav.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={compact ? item.label : undefined}
                className={`focus-ring flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold transition-colors duration-150 ${
                  active ? "bg-white/12 text-white shadow-[inset_3px_0_0_var(--gold)] rtl:shadow-[inset_-3px_0_0_var(--gold)]" : "text-white/70 hover:bg-white/8 hover:text-white"
                } ${compact ? "justify-center px-0" : ""}`}
              >
                <span className="shrink-0">{item.icon}</span>
                {!compact && <span className="truncate">{item.label}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
  );

  const sidebarBody = (compact: boolean) => (
      <div className="flex h-full flex-col">
        <div className={`flex h-16 items-center gap-2.5 border-b border-white/10 px-4 ${compact ? "justify-center px-0" : ""}`}>
          <LogoMark size={32} />
          {!compact && (
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-sm font-extrabold text-white">Bakhta</span>
              <span className="truncate text-[0.68rem] font-semibold uppercase tracking-wider text-gold-300">{a.brand.console}</span>
            </span>
          )}
        </div>
        <nav aria-label={a.nav.main} className="flex-1 overflow-y-auto p-3">
          {navLinks(compact)}
        </nav>
        <div className="border-t border-white/10 p-3">
          <Link
            href="/"
            className={`focus-ring flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs font-semibold text-white/60 hover:bg-white/8 hover:text-white ${compact ? "justify-center px-0" : ""}`}
            title={a.nav.publicSite}
          >
            <span aria-hidden="true">↗</span>
            {!compact && a.nav.publicSite}
          </Link>
        </div>
      </div>
  );

  return (
    <CrumbContext.Provider value={setCrumbs}>
      <div className="flex min-h-screen w-full bg-background">
        {/* Desktop sidebar */}
        <aside
          className={`sticky top-0 hidden h-screen shrink-0 bg-[linear-gradient(180deg,var(--brand-900)_0%,#032519_100%)] transition-[width] duration-200 ease-out-soft lg:block ${
            collapsed ? "w-[4.5rem]" : "w-64"
          }`}
        >
          {sidebarBody(collapsed)}
        </aside>

        {/* Mobile drawer */}
        {drawer && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-foreground/50" onClick={() => setDrawer(false)} aria-hidden="true" />
            <aside className="animate-fade-in absolute inset-y-0 start-0 w-72 max-w-[85vw] bg-[linear-gradient(180deg,var(--brand-900)_0%,#032519_100%)] shadow-lg">
              <button
                type="button"
                onClick={() => setDrawer(false)}
                className="absolute end-2 top-3 rounded-md p-2 text-white/70 hover:bg-white/10 hover:text-white"
                aria-label={a.nav.closeMenu}
              >
                <CloseIcon className="h-5 w-5" />
              </button>
              {sidebarBody(false)}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            className="sticky z-30 flex h-16 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur-md sm:px-5"
            style={{ top: "env(safe-area-inset-top, 0px)" }}
          >
            <button type="button" className="btn btn-ghost btn-sm px-2 lg:hidden" onClick={() => setDrawer(true)} aria-label={a.nav.openMenu}>
              <MenuIcon />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm hidden px-2 lg:inline-flex"
              onClick={toggleCollapsed}
              aria-label={collapsed ? a.nav.expand : a.nav.collapse}
              aria-pressed={collapsed}
            >
              <ChevronIcon flip={collapsed} />
            </button>

            <nav aria-label={a.nav.breadcrumb} className="min-w-0 flex-1">
              <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                <li className="hidden shrink-0 text-muted sm:block">
                  <Link href="/admin" className="focus-ring rounded hover:text-foreground">
                    {a.nav.admin}
                  </Link>
                </li>
                {crumbs.map((c, i) => (
                  <li key={i} className="flex min-w-0 items-center gap-1.5">
                    <span className={`text-border-strong ${i === 0 ? "hidden sm:inline" : ""}`} aria-hidden="true">
                      /
                    </span>
                    {c.href && i < crumbs.length - 1 ? (
                      <Link href={c.href} className="focus-ring truncate rounded text-muted hover:text-foreground">
                        {c.label}
                      </Link>
                    ) : (
                      <span className="truncate font-semibold text-foreground" aria-current="page">
                        {c.label}
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </nav>

            <LanguageSwitcher />
            <div className="hidden items-center gap-2.5 border-s border-border ps-3 md:flex">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand">
                <UserIcon className="h-4 w-4" />
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="max-w-44 truncate text-xs font-semibold text-foreground" dir="ltr" title={me?.email}>
                  {me?.email}
                </span>
                <span className="text-[0.68rem] font-bold uppercase tracking-wide text-gold-700">{roleLabel}</span>
              </span>
            </div>
            <button type="button" className="btn btn-ghost btn-sm px-2 text-danger hover:text-danger" onClick={() => void logout()} aria-label={a.top.logout} title={a.top.logout}>
              <LogoutIcon className="h-5 w-5" />
            </button>
          </header>

          <main className="mx-auto w-full max-w-[90rem] flex-1 px-3 py-5 sm:px-6 sm:py-7">{children}</main>
        </div>
      </div>
    </CrumbContext.Provider>
  );
}
