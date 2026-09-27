import type { Metadata } from "next";
import { AdminAuthProvider } from "@/lib/admin/auth-context";
import { ToastProvider } from "@/components/admin/ui";

export const metadata: Metadata = {
  title: "Bakhta Admin",
  robots: { index: false, follow: false },
};

// The admin area has its own session (AdminAuthProvider) — the customer AuthProvider,
// header and footer live only in app/(site)/layout.tsx and never load here.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminAuthProvider>
      <ToastProvider>{children}</ToastProvider>
    </AdminAuthProvider>
  );
}
