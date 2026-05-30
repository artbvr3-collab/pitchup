/**
 * MODULE: app.admin.admin-bottom-nav
 * PURPOSE: Four-tab bottom navigation for the admin panel (Users / Matches /
 *          Venues / Reports), mounted in `app/admin/layout.tsx`. Pill-style
 *          active tab, mirroring the public BottomNav. Admin-only — never
 *          rendered for regular users (the whole `/admin` tree is gated by
 *          middleware + `requireAdminPage`).
 * LAYER: interfaces (client)
 * DEPENDENCIES: next/navigation, next/link, src/ui/lib/cn
 * CONSUMED BY: app/admin/layout.tsx
 * INVARIANTS:
 *   - Active tab determined by `usePathname()` prefix match.
 *   - The public five-tab BottomNav is hidden on `/admin` (see HIDDEN_PATHS in
 *     src/ui/components/bottom-nav.tsx) so the two bars never stack.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin" → Layout.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/src/ui/lib/cn";

interface AdminTab {
  readonly label: string;
  readonly href: string;
  readonly activePrefix: string;
}

const TABS: readonly AdminTab[] = [
  { label: "Users", href: "/admin/users", activePrefix: "/admin/users" },
  { label: "Matches", href: "/admin/matches", activePrefix: "/admin/matches" },
  { label: "Venues", href: "/admin/venues", activePrefix: "/admin/venues" },
  { label: "Reports", href: "/admin/reports", activePrefix: "/admin/reports" },
];

export function AdminBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="sticky bottom-0 z-40 flex h-14 w-full items-stretch border-t border-border bg-bg-base"
      aria-label="Admin navigation"
    >
      {TABS.map((tab) => {
        const isActive =
          pathname === tab.activePrefix ||
          pathname.startsWith(`${tab.activePrefix}/`);
        return (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center text-[13px] font-medium transition-colors",
              isActive ? "text-lime-text" : "text-text-secondary",
            )}
          >
            <span
              className={cn(
                "flex h-8 items-center justify-center rounded-full px-3 transition-colors",
                isActive && "bg-lime",
              )}
            >
              {tab.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
