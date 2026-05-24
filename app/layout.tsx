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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="bg-bg-surface font-sans text-[15px] text-text-primary">
        <div className="mx-auto min-h-dvh max-w-screen bg-bg-base">{children}</div>
      </body>
    </html>
  );
}
