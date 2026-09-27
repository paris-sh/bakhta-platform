import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, Vazirmatn } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/lib/i18n/locale-context";
import { DEFAULT_LOCALE, LOCALE_COOKIE, MESSAGES, isLocale, localeDir, type Locale } from "@/lib/i18n/messages";

// Both self-hosted at build time by next/font — no runtime request to Google.
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  display: "swap",
  variable: "--font-vazirmatn",
});

/** The visitor's saved language, or English for first-time visitors. Read on the server so
 * the very first HTML already carries the right lang/dir (no LTR→RTL flash). */
async function requestLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = MESSAGES[await requestLocale()];
  return { title: t.meta.title, description: t.meta.description };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await requestLocale();
  return (
    <html lang={locale} dir={localeDir(locale)} className={`${inter.variable} ${vazirmatn.variable}`}>
      <body className="flex min-h-screen flex-col antialiased">
        {/* Shared by the customer site ((site)/layout.tsx) and the admin panel
            (admin/layout.tsx), which each bring their own, fully separate session. */}
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
