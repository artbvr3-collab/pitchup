/**
 * MODULE: app.layout
 * PURPOSE: Root App Router layout. Loads Inter from next/font, applies global
 *          CSS (tokens + Tailwind base), wraps the app in the canonical
 *          375px-wide mobile container on a cream surface background.
 * LAYER: interfaces
 * RELATED DOCS: docs/ARCHITECTURE.md §11.
 */
import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

import { optionalAuth } from "@/src/auth/composition";
import { BottomNav } from "@/src/ui/components/bottom-nav";

import { AppProviders } from "./app-providers";
import { SignedInChrome } from "./signed-in-chrome";
import { SplashScreen } from "./splash-screen";

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "PITCHUP",
  description: "Pickup football matchmaking",
  applicationName: "PITCHUP",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  // iOS standalone: launch from the home screen without Safari chrome.
  // Next emits the modern `mobile-web-app-capable` (iOS 16.4+); we add the
  // legacy `apple-mobile-web-app-capable` via `other` for older iPhones.
  appleWebApp: {
    capable: true,
    title: "PITCHUP",
    statusBarStyle: "default",
  },
  other: {
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f5f0e8",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Render the signed-in chrome (TopBar 🔔 + Updates panel + global poll) only
  // when there's a valid, onboarded session. Guests / not-yet-onboarded
  // (/login, /welcome) get `null` → no chrome. The chrome itself further gates
  // which routes show the bar (see SignedInChrome).
  const session = await optionalAuth();

  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <body className="bg-bg-surface font-sans text-[15px] text-text-primary">
        <AppProviders>
          <SplashScreen />
          <div className="mx-auto flex min-h-dvh max-w-screen flex-col bg-bg-base">
            {session && <SignedInChrome />}
            <div className="flex-1">{children}</div>
            <BottomNav isSignedIn={!!session} />
          </div>
        </AppProviders>
      </body>
    </html>
  );
}
