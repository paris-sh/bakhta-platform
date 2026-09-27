import { AuthProvider } from "@/lib/auth-context";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

// Customer-facing site: its own session (AuthProvider), header and footer. The admin panel
// lives under app/admin with a completely separate session and shell.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SiteHeader />
      <main className="w-full flex-1">{children}</main>
      <SiteFooter />
    </AuthProvider>
  );
}
