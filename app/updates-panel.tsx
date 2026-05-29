/**
 * MODULE: app.updates-panel
 * PURPOSE: The in-app inbox — a bottom-sheet listing up to 20 recent
 *          notifications (spec global.md → "Updates panel"). Icon by type +
 *          one body line + relative time; tapping an item navigates to
 *          `/matches/:id` and closes the panel. Mark-as-read is fired by the
 *          parent (SignedInChrome) when the panel opens — this component is
 *          presentational.
 * LAYER: interfaces (client)
 * DEPENDENCIES: next/navigation, src/ui/components/sheet,
 *               src/notifications/domain/notification (NotificationType, type-only)
 * INVARIANTS:
 *   - Read-only list. No "[Show older]" / pagination in v1 (known gap,
 *     personal.md). Cap is the 20 the parent feeds in.
 *   - Tap → `/matches/:id` only when `match_id` is non-null (all v1 events
 *     carry a match; the null guard is future-proofing for match-less types).
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Notifications" (Item
 *               structure, icons by type, Empty state).
 */
"use client";

import { useRouter } from "next/navigation";

import type { NotificationType } from "@/src/notifications/domain/notification";
import { Sheet } from "@/src/ui/components/sheet";

export interface UpdateItem {
  readonly id: string;
  readonly type: NotificationType;
  readonly match_id: string | null;
  readonly body: string;
  readonly ts: string;
}

/** Icon per type — spec global.md → "Updates panel" → "Item structure". */
const ICON_BY_TYPE: Record<NotificationType, string> = {
  approved: "✓",
  rejected: "✗",
  kicked: "🚫",
  match_cancelled: "⚠️",
  match_updated: "🔄",
  spot_opened: "🟢",
  morning_reminder: "💬",
};

export interface UpdatesPanelProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly items: readonly UpdateItem[];
}

export function UpdatesPanel({ open, onClose, items }: UpdatesPanelProps) {
  const router = useRouter();

  const openItem = (item: UpdateItem): void => {
    onClose();
    if (item.match_id) router.push(`/matches/${item.match_id}`);
  };

  return (
    <Sheet open={open} onClose={onClose} ariaLabel="Updates">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-text-primary">Updates</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="text-[18px] text-text-secondary"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        {items.length === 0 ? (
          <p className="px-4 py-12 text-center text-[14px] text-text-secondary">
            No updates yet
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-card-dim"
                >
                  <span className="text-[18px] leading-none" aria-hidden>
                    {ICON_BY_TYPE[item.type] ?? "🔔"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-text-primary">
                      {item.body}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-text-muted">
                      {relativeTime(item.ts)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** Compact "2h ago" formatter (spec item structure shows relative time). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}
