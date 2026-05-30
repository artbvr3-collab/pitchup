/**
 * MODULE: ui.components.bottom-nav
 * PURPOSE: Persistent 5-tab bottom navigation bar (My matches | Games | Map |
 *          Chats | Me). Pill-style active tab. Mounted in the root layout;
 *          hidden on /login and /welcome. Guest-accessible (auth-only tabs
 *          redirect to /login?callbackUrl=<tab>). Syncs filter params between
 *          /games and /map via URL (sheet filters are preserved; ?date= is
 *          dropped when navigating to /map; ?date= defaults to today when
 *          navigating to /games).
 * LAYER: ui
 * DEPENDENCIES: next/navigation, next/link
 * CONSUMED BY: app/layout.tsx
 * INVARIANTS:
 *   - Hidden entirely on /welcome and /login.
 *   - Active tab determined by usePathname().
 *   - Guest tapping auth-only tab goes to /login?callbackUrl=<tab url>.
 *   - Map tab preserves sheet filters (?distance, ?time, ?size, ?spots,
 *     ?free, ?booked) from the current URL, drops ?date= and ?cursor=.
 *   - Games tab preserves sheet filters, drops ?date= (defaults to today).
 * RELATED DOCS: docs/spec/pitchup-app-map.md → "Navigation (BottomNav)".
 */
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as React from "react";

import { cn } from "../lib/cn";

interface Tab {
  readonly label: string;
  readonly href: string;
  readonly icon: React.ReactNode;
  readonly authOnly: boolean;
  /** Pathnames that mark this tab as active. */
  readonly activePrefix: string;
}

// SVG icon helpers — inline, no external lib dependency.
function IconCalendar() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconList() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function IconMap() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
      <line x1="8" y1="2" x2="8" y2="18" />
      <line x1="16" y1="6" x2="16" y2="22" />
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconPerson() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/** Paths where the BottomNav is hidden entirely. */
const HIDDEN_PATHS = ["/login", "/welcome"];

/** Sheet filter params shared between /games and /map. */
const SHEET_PARAMS = ["distance", "time", "size", "spots", "free", "booked"];

export interface BottomNavProps {
  readonly isSignedIn: boolean;
}

export function BottomNav({ isSignedIn }: BottomNavProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (HIDDEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  // Build the shared sheet-filter query string (no date, no cursor).
  const sheetParams = new URLSearchParams();
  for (const key of SHEET_PARAMS) {
    const val = searchParams.get(key);
    if (val) sheetParams.set(key, val);
  }
  const sheetQs = sheetParams.toString();

  const gamesHref = sheetQs ? `/games?${sheetQs}` : "/games";
  const mapHref = sheetQs ? `/map?${sheetQs}` : "/map";

  const tabs: Tab[] = [
    {
      label: "My matches",
      href: "/my-matches",
      icon: <IconCalendar />,
      authOnly: true,
      activePrefix: "/my-matches",
    },
    {
      label: "Games",
      href: gamesHref,
      icon: <IconList />,
      authOnly: false,
      activePrefix: "/games",
    },
    {
      label: "Map",
      href: mapHref,
      icon: <IconMap />,
      authOnly: false,
      activePrefix: "/map",
    },
    {
      label: "Chats",
      href: "/chats",
      icon: <IconChat />,
      authOnly: true,
      activePrefix: "/chats",
    },
    {
      label: "Me",
      href: "/me",
      icon: <IconPerson />,
      authOnly: true,
      activePrefix: "/me",
    },
  ];

  return (
    <nav
      className="sticky bottom-0 z-40 flex h-14 w-full items-stretch border-t border-border bg-bg-base"
      aria-label="Main navigation"
    >
      {tabs.map((tab) => {
        const isActive =
          pathname === tab.activePrefix ||
          pathname.startsWith(`${tab.activePrefix}/`);
        const isDisabled = tab.authOnly && !isSignedIn;
        const href = isDisabled
          ? `/login?callbackUrl=${encodeURIComponent(tab.href)}`
          : tab.href;

        return (
          <Link
            key={tab.label}
            href={href}
            aria-label={tab.label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors",
              isActive
                ? "text-lime-text"
                : isDisabled
                  ? "text-text-muted"
                  : "text-text-secondary",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-14 items-center justify-center rounded-full transition-colors",
                isActive && "bg-lime",
              )}
            >
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
