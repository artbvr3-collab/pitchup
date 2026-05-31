/**
 * MODULE: app.(private).my-matches.past-list-with-show-more
 * PURPOSE: Client island that owns the `[Show more]` pagination for Section
 *          Past on /my-matches. Renders the initial server-rendered rows,
 *          appends fetched rows on each tap, and hides the button when the
 *          cursor is exhausted.
 * LAYER: interfaces (client component)
 * DEPENDENCIES: GET /api/my-matches/past?cursor=
 * INVARIANTS:
 *   - This is the ONLY client island on /my-matches. Captain + Upcoming
 *     sections + initial Past list are pure RSC.
 *   - Pagination keyset cursor format matches `encodeCursor` from
 *     `discover-filters.ts` (`base64url(JSON{s, i})`). The client treats it
 *     as opaque — encode/decode lives server-side only.
 *   - On fetch error: keep the existing rows visible, show inline error
 *     message + retry button. The page is not navigation — losing scroll
 *     position on a transient network blip is worse UX than a small banner.
 *   - PastWireRow uses snake_case to mirror the spec convention for poll
 *     payloads, even though this isn't a poll. Keeps the route handler's
 *     shape consistent with the rest of the API surface.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/my-matches → Section Past"
 *     → "[Show more] loads next 20 cards"
 */
"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import type { MatchStatus } from "@/src/match_lifecycle/domain/match-status";
import type { MyStatus } from "@/src/match_lifecycle/domain/derive-my-status";
import type { JoinRequestStatus } from "@/src/match_lifecycle/domain/join-request";
import { MatchCard } from "@/src/ui/components/match-card";
import { cn } from "@/src/ui/lib/cn";

export interface PastWireRow {
  readonly match_id: string;
  readonly cover_id: string;
  readonly venue_name: string;
  readonly venue_address: string;
  readonly start_time: string;
  readonly duration: number;
  readonly surface: "grass" | "hard";
  readonly studs_allowed: boolean;
  readonly field_booked: boolean;
  readonly price: number;
  readonly slots: { filled: number; capacity: number; free: number };
  readonly match_status: MatchStatus;
  readonly my_status: MyStatus;
  readonly is_captain: boolean;
  readonly join_request_status: JoinRequestStatus | null;
  readonly join_request_auto_reason:
    | "match_started"
    | "match_cancelled"
    | null;
}

export interface PastListInitialState {
  readonly rows: readonly PastWireRow[];
  readonly nextCursor: string | null;
}

export interface PastListWithShowMoreProps {
  readonly initial: PastListInitialState;
  /**
   * Match ids to badge "👍 Awaiting likes" — the Likes-reminder 2+ case
   * (spec personal.md → "Likes reminder section"). Empty for the 0/1 cases.
   */
  readonly awaitingLikeIds?: readonly string[];
}

export function PastListWithShowMore({
  initial,
  awaitingLikeIds = [],
}: PastListWithShowMoreProps) {
  const awaitingSet = new Set(awaitingLikeIds);
  const [rows, setRows] = useState<readonly PastWireRow[]>(initial.rows);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/my-matches/past", window.location.origin);
      url.searchParams.set("cursor", cursor);
      const res = await fetch(url.toString(), { credentials: "same-origin" });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        rows: readonly PastWireRow[];
        next_cursor: string | null;
      };
      setRows((prev) => [...prev, ...data.rows]);
      setCursor(data.next_cursor);
    } catch {
      setError("Couldn't load more. Try again.");
    } finally {
      setLoading(false);
    }
  }, [cursor, loading]);

  return (
    <div>
      <div className="space-y-3">
        {rows.map((row) => (
          <PastRow
            key={row.match_id}
            row={row}
            awaiting={awaitingSet.has(row.match_id)}
          />
        ))}
      </div>
      {error && (
        <div className="mt-3 text-[12px] text-status-full">{error}</div>
      )}
      {cursor && (
        <button
          type="button"
          onClick={loadMore}
          disabled={loading}
          className={cn(
            "mt-4 inline-flex h-11 w-full items-center justify-center rounded-btn border border-border-strong bg-bg-card px-4 text-[14px] font-semibold text-text-primary transition-colors",
            loading
              ? "cursor-wait opacity-60"
              : "hover:bg-bg-card-dim active:bg-bg-card-dim",
          )}
        >
          {loading ? "Loading…" : "Show more"}
        </button>
      )}
    </div>
  );
}

function PastRow({
  row,
  awaiting = false,
}: {
  row: PastWireRow;
  awaiting?: boolean;
}) {
  const subLabel = derivePastSubLabel(row);
  const badge = row.is_captain
    ? { label: "Captain", tone: "captain" as const }
    : null;

  return (
    <div>
      {(badge || awaiting) && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {badge && (
            <span className="inline-flex items-center rounded-badge bg-green-dark px-2 py-0.5 text-[11px] font-semibold text-text-inverted">
              {badge.label}
            </span>
          )}
          {awaiting && (
            <span className="inline-flex items-center rounded-badge bg-lime px-2 py-0.5 text-[11px] font-bold text-lime-text">
              👍 Awaiting likes
            </span>
          )}
        </div>
      )}
      <MatchCard
        href={`/matches/${row.match_id}`}
        coverId={row.cover_id}
        venueName={row.venue_name}
        venueAddress={row.venue_address}
        startTime={new Date(row.start_time)}
        duration={row.duration}
        surface={row.surface}
        studsAllowed={row.studs_allowed}
        fieldBooked={row.field_booked}
        price={row.price}
        status={row.match_status}
        slots={row.slots}
      />
      {subLabel && (
        <div className="mt-1 px-1 text-[12px] text-text-secondary">
          {subLabel}
        </div>
      )}
    </div>
  );
}

function derivePastSubLabel(row: PastWireRow): string | null {
  if (row.is_captain) return null;
  const s = row.join_request_status;
  if (!s) return null;
  if (s === "accepted") {
    return row.match_status === "cancelled" ? "Match was cancelled" : "Played";
  }
  if (s === "left") return "You left";
  if (s === "kicked") return "You were removed";
  if (s === "cancelled") return "You cancelled your request";
  if (s === "rejected") {
    switch (row.join_request_auto_reason) {
      case "match_started":
        return "Request expired";
      case "match_cancelled":
        return "Match was cancelled";
      default:
        return "Request declined";
    }
  }
  return null;
}

// Keep the bottom Link import side-effect free — tree-shaken away if unused.
export const _kept = Link;
