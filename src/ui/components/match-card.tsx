/**
 * MODULE: ui.components.match-card
 * PURPOSE: Discover-feed card. Visualises one upcoming match: venue + address,
 *          status pill (top-right), Prague-TZ date/time, surface + studs +
 *          booked chips, slot counter with status color, price label.
 *          Approximation until a canonical `mockups/games.html` ships — the
 *          card uses the same primitives + tokens as match.html
 *          (.preview-card, .player-chip), so the visual identity is already
 *          consistent with the rest of the brand. Cover image deliberately
 *          omitted for now; will be reintroduced when venue photos exist.
 * LAYER: ui
 * DEPENDENCIES: ./card, ./chip, ../lib/cn
 * CONSUMED BY: app/(public)/games/page.tsx
 * INVARIANTS:
 *   - Pure presentational. All derivation (status, slot math, formatting) is
 *     done upstream — this component only reads the view-model.
 *   - Renders an <a> link, not a button — entire card is one click target
 *     (spec: "MatchCard → /matches/:id").
 *   - Dates formatted in Europe/Prague TZ regardless of server locale.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games".
 */
import Link from "next/link";
import * as React from "react";

import { cn } from "@/src/ui/lib/cn";

const STATUS_LABEL: Record<MatchCardProps["status"], string> = {
  open: "Open",
  almostFull: "Almost full",
  full: "Full",
  inProgress: "In progress",
  ended: "Ended",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<MatchCardProps["status"], string> = {
  open: "bg-status-open",
  almostFull: "bg-status-almost",
  full: "bg-status-full",
  inProgress: "bg-status-in-progress",
  ended: "bg-status-in-progress",
  cancelled: "bg-status-full",
};

const SURFACE_LABEL: Record<MatchCardProps["surface"], string> = {
  grass: "Grass",
  hard: "Hard",
};

export interface MatchCardProps {
  readonly href: string;
  readonly venueName: string;
  readonly venueAddress: string;
  readonly startTime: Date;
  readonly duration: number; // minutes
  readonly surface: "grass" | "hard";
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly price: number; // CZK; 0 = Free
  readonly status:
    | "open"
    | "almostFull"
    | "full"
    | "inProgress"
    | "ended"
    | "cancelled";
  readonly slots: {
    readonly filled: number;
    readonly capacity: number;
    readonly free: number;
  };
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatPrice(czk: number): string {
  return czk === 0 ? "Free" : `${czk} Kč`;
}

export function MatchCard(props: MatchCardProps) {
  const dateLabel = dateFormatter.format(props.startTime);
  const timeLabel = timeFormatter.format(props.startTime);
  const statusLabel = STATUS_LABEL[props.status];
  const statusColor = STATUS_COLOR[props.status];

  return (
    <Link
      href={props.href}
      className={cn(
        "block overflow-hidden rounded-card bg-bg-card shadow-card transition-shadow hover:shadow-btn",
      )}
    >
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight text-text-primary">
              {props.venueName}
            </div>
            <div className="mt-0.5 text-[12px] text-text-secondary">
              {props.venueAddress}
            </div>
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center justify-center rounded-chip px-3 py-1 text-[11px] font-semibold leading-none text-text-inverted",
              statusColor,
            )}
          >
            {statusLabel}
          </span>
        </div>

        <div className="flex items-baseline gap-2 text-[13px] text-text-primary">
          <span className="font-semibold">{dateLabel}</span>
          <span className="text-text-secondary">·</span>
          <span className="font-semibold">{timeLabel}</span>
          <span className="text-text-secondary">·</span>
          <span className="text-text-secondary">{props.duration} min</span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="inline-flex items-center rounded-badge border border-border bg-bg-card-dim px-2 py-0.5 text-text-secondary">
            {SURFACE_LABEL[props.surface]}
          </span>
          {props.surface === "grass" && (
            <span className="inline-flex items-center rounded-badge border border-border bg-bg-card-dim px-2 py-0.5 text-text-secondary">
              {props.studsAllowed ? "Studs OK" : "No studs"}
            </span>
          )}
          {props.fieldBooked && (
            <span className="inline-flex items-center rounded-badge border border-border bg-bg-card-dim px-2 py-0.5 text-text-secondary">
              ✓ Field booked
            </span>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3 text-[13px]">
          <div className="text-text-primary">
            <span className="font-semibold">
              {props.slots.filled} / {props.slots.capacity}
            </span>
            <span className="ml-2 text-text-secondary">
              {props.slots.free === 0
                ? "no spots left"
                : `${props.slots.free} ${props.slots.free === 1 ? "spot" : "spots"} open`}
            </span>
          </div>
          <div className="font-semibold text-text-primary">
            {formatPrice(props.price)}
          </div>
        </div>
      </div>
    </Link>
  );
}
