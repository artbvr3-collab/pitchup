/**
 * MODULE: app.signed-in-chrome
 * PURPOSE: Shared chrome for signed-in users — the TopBar with the 🔔 bell +
 *          red dot, the Updates panel, and the GLOBAL poll
 *          (`GET /api/updates/state`). Mounted once in the root layout when a
 *          session exists; activates only on the main app routes
 *          (/my-matches, /me, /games). The match page has its own chrome and
 *          per-match poll, so the bar is suppressed there.
 * LAYER: interfaces (client)
 * DEPENDENCIES: next/navigation, next/link, src/ui/hooks/use-polling,
 *               ./updates-panel, src/notifications/application/updates-state-service
 *               (UpdatesStateResponse, type-only)
 * INVARIANTS:
 *   - Polling reuses `usePolling`. The `since` cursor advances to the response
 *     time ONLY when it is still null (bootstrap) OR the payload carried
 *     content (new notifications / matches_changed). Idle polls leave `since`
 *     unchanged, so the poll URL is stable and the hook keeps its 15s/60s
 *     timer; a content poll bumps `since` → one immediate catch-up poll →
 *     settle (same shape as MatchShell's message cursor). This both prevents a
 *     tight restart-loop AND prevents a consumed delta from re-firing forever.
 *   - `matches_changed` non-empty → `router.refresh()` (re-renders the current
 *     RSC route — /my-matches today; /chats when it ships). The per-match page
 *     refreshes via its own poll, not this one.
 *   - Red dot = `has_unread_notifications` boolean. Opening the panel fires
 *     `POST /api/updates/read` and optimistically clears the dot; other tabs
 *     clear on their next poll (spec multi-tab consistency).
 *   - 401 → session invalid (ban / delete) → redirect to /login.
 *   - Browser Notification API + email are Layer 7b — NOT wired here.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Notifications", "Polling sync"
 */
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import type { UpdatesStateResponse } from "@/src/notifications/application/updates-state-service";
import { PollingHttpError, usePolling } from "@/src/ui/hooks/use-polling";

import { UpdatesPanel, type UpdateItem } from "./updates-panel";

/** Routes where the signed-in TopBar shows and the global poll runs. */
const ACTIVE_PREFIXES = ["/my-matches", "/me", "/games"];

export function SignedInChrome() {
  const pathname = usePathname();
  const router = useRouter();

  const isActive = ACTIVE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

  const [since, setSince] = useState<string | null>(null);
  const [hasUnread, setHasUnread] = useState(false);
  const [items, setItems] = useState<readonly UpdateItem[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  const pollUrl = useMemo(
    () =>
      `/api/updates/state${since ? `?since=${encodeURIComponent(since)}` : ""}`,
    [since],
  );

  usePolling<UpdatesStateResponse>({
    url: pollUrl,
    enabled: isActive,
    onPayload: (payload) => {
      setHasUnread(payload.has_unread_notifications);
      if (payload.new_notifications.length > 0) {
        setItems((prev) => mergeItems(prev, payload.new_notifications));
      }
      if (payload.matches_changed.length > 0) {
        router.refresh();
      }
      setSince((prev) =>
        prev === null ||
        payload.new_notifications.length > 0 ||
        payload.matches_changed.length > 0
          ? new Date().toISOString()
          : prev,
      );
    },
    onError: (err) => {
      if (err instanceof PollingHttpError && err.status === 401) {
        router.push("/login");
      }
    },
  });

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    setHasUnread(false); // optimistic; other tabs clear on next poll
    void fetch("/api/updates/read", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => {
      // Best-effort: if the read fails, the dot reappears on the next poll.
    });
  }, []);

  if (!isActive) return null;

  return (
    <>
      <header className="sticky top-0 z-30 mx-auto flex h-12 w-full max-w-[375px] items-center justify-between border-b border-border bg-bg-base/95 px-4 backdrop-blur">
        <Link
          href="/my-matches"
          aria-label="PITCHUP home"
          className="flex items-center text-[16px] font-extrabold tracking-tight text-text-primary"
        >
          <span>PITCH</span>
          <span className="ml-0.5 rounded-[6px] bg-lime px-1 text-lime-text">
            UP
          </span>
        </Link>

        <button
          type="button"
          onClick={openPanel}
          aria-label="Updates"
          className="relative -mr-1 flex h-9 w-9 items-center justify-center rounded-full text-[20px]"
        >
          <span aria-hidden>🔔</span>
          {hasUnread && (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-status-full ring-2 ring-bg-base"
            />
          )}
        </button>
      </header>

      <UpdatesPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        items={items}
      />
    </>
  );
}

/** Merge incoming notifications into the panel list, dedupe by id, newest first, cap 20. */
function mergeItems(
  prev: readonly UpdateItem[],
  incoming: readonly UpdateItem[],
): readonly UpdateItem[] {
  const byId = new Map<string, UpdateItem>();
  for (const n of incoming) byId.set(n.id, n);
  for (const n of prev) if (!byId.has(n.id)) byId.set(n.id, n);
  return [...byId.values()]
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 20);
}
