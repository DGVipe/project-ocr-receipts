import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { PageSkeleton } from "@/components/page-skeleton";
import { ThemeProvider } from "@/components/theme-provider";
import { serverEnv } from "@/lib/server/env";
import { I18nProvider } from "@/lib/i18n";
import { LOCALE_COOKIE, localeFromAcceptLanguage, parseLocale } from "@/lib/i18n/locale";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Receipt Scanner",
  description: "Scan purchase receipts and extract the store, date and total with OCR.",
  // The SVG carries its own prefers-color-scheme rule: black on light, white on dark.
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

/**
 * Picks the language before anything renders: the saved choice, or on a first
 * visit the browser's language (Accept-Language), so the page never switches.
 */
async function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Dev-only (SKELETON_DELAY_MS): keep the skeleton on screen long enough to inspect it.
  if (serverEnv.skeletonDelayMs) await new Promise((r) => setTimeout(r, serverEnv.skeletonDelayMs));
  const saved = parseLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const locale = saved ?? localeFromAcceptLanguage((await headers()).get("accept-language"));
  return <I18nProvider initialLocale={locale}>{children}</I18nProvider>;
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <Suspense fallback={<PageSkeleton />}>
            <LocaleProvider>
              <ConvexClientProvider>{children}</ConvexClientProvider>
              <Toaster richColors position="top-center" />
            </LocaleProvider>
          </Suspense>
        </ThemeProvider>
      </body>
    </html>
  );
}
