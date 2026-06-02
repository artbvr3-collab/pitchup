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
 * DEPENDENCIES: next/navigation, next/link, @phosphor-icons/react
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

import { cn } from "../lib/cn";
import { Icon } from "./icon";

interface Tab {
  readonly label: string;
  readonly href: string;
  /** Solar icon base slug; `-linear` (inactive) / `-bold-duotone` (active)
   *  is appended at render to mimic the iOS outline→fill pattern. */
  readonly iconName: string;
  readonly authOnly: boolean;
  /** Pathnames that mark this tab as active. */
  readonly activePrefix: string;
}

/** Paths where the BottomNav is hidden entirely. `/admin` has its own
 *  four-tab admin nav (app/admin/admin-bottom-nav.tsx), so the public
 *  five-tab bar must not also render there (Layer 9). */
const HIDDEN_PATHS = ["/login", "/welcome", "/admin"];

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
      iconName: "calendar",
      authOnly: true,
      activePrefix: "/my-matches",
    },
    {
      label: "Games",
      href: gamesHref,
      iconName: "football",
      authOnly: false,
      activePrefix: "/games",
    },
    {
      label: "Map",
      href: mapHref,
      iconName: "map-point-wave",
      authOnly: false,
      activePrefix: "/map",
    },
    {
      label: "Chats",
      href: "/chats",
      iconName: "chat-round-dots",
      authOnly: true,
      activePrefix: "/chats",
    },
    {
      label: "Me",
      href: "/me",
      iconName: "user-circle",
      authOnly: true,
      activePrefix: "/me",
    },
  ];

  return (
    <nav
      className="sticky bottom-0 z-40 flex h-14 w-full items-stretch bg-bg-base/90 shadow-[var(--shadow-nav)] backdrop-blur-md"
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
                "flex h-7 w-14 items-center justify-center rounded-full transition-all",
                isActive && "bg-gradient-lime shadow-btn-lime",
              )}
            >
              <Icon
                name={`${tab.iconName}-${isActive ? "bold-duotone" : "linear"}`}
                size={22}
              />
            </span>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
