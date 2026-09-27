"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/admin/auth-context";
import { useAdminI18n } from "@/lib/admin/i18n";
import { AdminShell } from "@/components/admin/AdminShell";
import { LogoMark } from "@/components/brand";

// Every admin page except /admin/login: requires an authenticated ADMIN session.
export default function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  const { status, expired } = useAdminAuth();
  const { a } = useAdminI18n();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "anonymous") router.replace(`/admin/login?next=${encodeURIComponent(pathname)}${expired ? "&expired=1" : ""}`);
  }, [status, expired, pathname, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label={a.common.loading}>
        <div className="flex flex-col items-center gap-3 text-muted">
          <LogoMark size={40} />
          <span className="h-1 w-24 overflow-hidden rounded-full bg-background-subtle">
            <span className="block h-full w-1/2 animate-pulse rounded-full bg-brand" />
          </span>
        </div>
      </div>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
