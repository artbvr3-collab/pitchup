/**
 * MODULE: app.layout
 * PURPOSE: Root App Router layout. Loads Inter from next/font, applies global
 *          CSS (tokens + Tailwind base), wraps the app in the canonical
 *          375px-wide mobile container on a cream surface background.
 * LAYER: interfaces
 * RELATED DOCS: docs/ARCHITECTURE.md §11.
 */
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

import { optionalAuth } from "@/src/auth/composition";

import { SignedInChrome } from "./signed-in-chrome";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PITCHUP",
  description: "Pickup football matchmaking",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
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
    <html lang="en" className={inter.variable}>
      <body className="bg-bg-surface font-sans text-[15px] text-text-primary">
        <div className="mx-auto min-h-dvh max-w-screen bg-bg-base">
          {session && <SignedInChrome />}
          {children}
        </div>
      </body>
    </html>
  );
}
