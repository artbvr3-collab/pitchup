/**
 * MODULE: app.matches.id.match-hero
 * PURPOSE: Top section of the match page — venue cover (the real venue photo
 *          when present, else the coverId gradient), venue name + address,
 *          date/time, duration, surface/studs/booked badges, description,
 *          organizer row, slot counter. Mirrors mockup `mockups/match.html`
 *          .hero + .match-header + .meta-list + .slot-counter.
 * LAYER: interfaces (client; pure presentational, no state)
 * DEPENDENCIES: src/ui/components/card, src/ui/lib/cn
 * INVARIANTS:
 *   - Date/time is rendered in Europe/Prague — same as MatchCard (spec
 *     "Match time display format").
 *   - Cancelled banner uses `cancelReason` from props (already filtered
 *     for `cancelReasonHidden` by the RSC).
 *   - `slots.filled / slots.capacity` is informational; the CTA bar is the
 *     action surface. The counter text mirrors mockup wording.
 * RELATED DOCS: mockups/match.html
 */
"use client";

import * as React from "react";

import { Card } from "@/src/ui/components/card";
import { cn } from "@/src/ui/lib/cn";
import { coverBackground, coverIcon } from "@/src/ui/lib/cover-style";
import type {
  MatchStateMessageAuthor,
  MatchStateWireStatus,
} from "@/src/match_lifecycle/application/dto/match-state";

export interface MatchHeroProps {
  readonly coverId: string;
  readonly photoUrl: string | null;
  readonly venueName: string;
  readonly venueAddress: string;
  readonly googleMapsUrl: string | null;
  readonly startTime: string; // ISO
  readonly duration: number;
  readonly price: number;
  readonly surface: "grass" | "hard";
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly description: string | null;
  readonly cancelReason: string | null;
  readonly status: MatchStateWireStatus;
  readonly captain: MatchStateMessageAuthor;
  readonly slots: { readonly filled: number; readonly capacity: number };
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  weekday: "short",
  day: "numeric",
  month: "short",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function MatchHero(props: MatchHeroProps) {
  const start = new Date(props.startTime);
  const dateText = dateFmt.format(start);
  const timeText = timeFmt.format(start);
  const initials = initialsOf(props.captain.name);
  const free = Math.max(0, props.slots.capacity - props.slots.filled);
  const slotColor =
    free === 0
      ? "text-status-full"
      : free <= 2
        ? "text-status-almost"
        : "text-status-open";

  return (
    <div className="flex flex-col gap-3">
      {/* Venue cover — the real venue photo when present, else the gradient +
          icon from the match's snapshotted coverId (same photo-first fallback
          as MatchCard / featured card). */}
      <div
        className="relative h-[160px] w-full overflow-hidden rounded-card"
        style={props.photoUrl ? undefined : { background: coverBackground(props.coverId) }}
      >
        {props.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote R2 host varies; plain img avoids next/image remotePatterns config
          <img
            src={props.photoUrl}
            alt={props.venueName}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className="absolute inset-0 flex items-center justify-center text-6xl opacity-90 drop-shadow"
            aria-hidden
          >
            {coverIcon(props.coverId)}
          </span>
        )}
      </div>

      {props.status === "Cancelled" && (
        <Card className="border border-destructive bg-destructive-bg">
          <p className="text-sm font-semibold text-destructive">
            Match cancelled
            {props.cancelReason ? ` · ${props.cancelReason}` : null}
          </p>
        </Card>
      )}

      <Card>
        <div className="flex flex-col gap-3">
          <div>
            <h1 className="text-[22px] font-bold leading-tight text-text-primary">
              {props.venueName}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {props.price === 0 ? "Free" : `${props.price} Kč / person`}
            </p>
          </div>

          <div className="flex flex-col gap-1.5 text-sm text-text-primary">
            <Row icon="📅" value={`${dateText} · ${timeText}`} />
            <Row icon="⏱" value={`${props.duration} min`} />
            <Row
              icon="📍"
              value={
                <>
                  {props.venueAddress}
                  {props.googleMapsUrl ? (
                    <>
                      {" "}
                      <a
                        href={props.googleMapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-green-dark underline"
                      >
                        Open map ↗
                      </a>
                    </>
                  ) : null}
                </>
              }
            />
          </div>

          {props.description && (
            <p className="text-sm text-text-primary">{props.description}</p>
          )}

          <div className="flex flex-wrap gap-1.5">
            <Tag>{props.surface === "grass" ? "🌱 Grass" : "🟫 Hard"}</Tag>
            <Tag>{props.studsAllowed ? "Studs OK" : "No studs"}</Tag>
            {props.fieldBooked ? (
              <Tag>Field booked</Tag>
            ) : (
              <Tag muted>Field not yet booked</Tag>
            )}
          </div>

          <div className="flex items-center gap-2 border-t border-border pt-3">
            <Avatar initials={initials} />
            <div className="flex-1">
              <p className="text-sm font-semibold">{props.captain.name}</p>
              <p className="text-xs text-text-muted">Organizer</p>
            </div>
            <span className="rounded-badge bg-lime px-2 py-0.5 text-xs font-bold text-lime-text">
              Captain
            </span>
          </div>

          <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
            <div>
              <span className={cn("font-semibold", slotColor)}>
                {props.slots.filled} / {props.slots.capacity} players
              </span>
              <span className="text-text-secondary">
                {" "}
                · {free === 0 ? "Match full" : `${free} spots open`}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Row({ icon, value }: { icon: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-base leading-none">{icon}</span>
      <span>{value}</span>
    </div>
  );
}

function Tag({
  children,
  muted = false,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "rounded-badge px-2 py-1 text-xs font-medium",
        muted
          ? "bg-bg-surface text-text-muted"
          : "bg-bg-surface text-text-primary",
      )}
    >
      {children}
    </span>
  );
}

function Avatar({ initials }: { initials: string }) {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-dark text-sm font-semibold text-text-inverted">
      {initials}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
