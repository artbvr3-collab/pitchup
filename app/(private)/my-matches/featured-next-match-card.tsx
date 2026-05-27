/**
 * MODULE: app.(private).my-matches.featured-next-match-card
 * PURPOSE: Larger "Your next match" card shown on top of Section Upcoming.
 *          Renders venue + date/time + countdown (when <24h) + slot counter
 *          + a primary `[View match →]` button. Visual upgrade of the
 *          standard MatchCard for the featured slot.
 * LAYER: interfaces (Server Component — pure presentational)
 * DEPENDENCIES: src/match_lifecycle/application/dto/my-matches
 * INVARIANTS:
 *   - Countdown is rendered only when delta < 24h. Rendered on the server
 *     using `now` from the parent page; the page re-renders on navigation,
 *     so a stale countdown is acceptable for Layer 6 (Layer 7 polling will
 *     refresh sections via `matches_changed`). Spec personal.md "Cards in
 *     Section Upcoming may show a stale status until reload — acceptable".
 *   - Link target uses `pickHref` from the same module family — captain on
 *     live → `?sheet=captain`, otherwise plain `/matches/:id`. Featured is
 *     the user's next match, which is by definition Upcoming (not Past),
 *     so we never hit the InProgress captain branch here.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/my-matches → Section Upcoming"
 *     → "First card — enlarged MatchCard styled as 'Your next match'"
 */
import Link from "next/link";

import type { MyMatchCardDto } from "@/src/match_lifecycle/application/dto/my-matches";

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

export interface FeaturedNextMatchCardProps {
  readonly card: MyMatchCardDto;
  readonly now: Date;
}

export function FeaturedNextMatchCard({
  card,
  now,
}: FeaturedNextMatchCardProps) {
  const start = card.match.startTime;
  const deltaMs = start.getTime() - now.getTime();
  const showCountdown = deltaMs > 0 && deltaMs < 24 * 60 * 60 * 1000;
  const href = card.isCaptain
    ? `/matches/${card.match.id}?sheet=captain`
    : `/matches/${card.match.id}`;

  return (
    <Link
      href={href}
      className="block overflow-hidden rounded-card bg-bg-card shadow-card transition-shadow hover:shadow-btn"
    >
      <div className="space-y-3 p-5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
          Your next match
        </div>
        <div className="text-[17px] font-bold leading-tight text-text-primary">
          {card.match.venue.name}
        </div>
        <div className="text-[13px] text-text-secondary">
          {card.match.venue.address}
        </div>
        <div className="flex items-baseline gap-2 text-[14px] text-text-primary">
          {showCountdown ? (
            <span className="font-bold text-green-dark">
              {formatCountdown(deltaMs)}
            </span>
          ) : (
            <>
              <span className="font-semibold">
                {dateFormatter.format(start)}
              </span>
              <span className="text-text-secondary">·</span>
              <span className="font-semibold">
                {timeFormatter.format(start)}
              </span>
            </>
          )}
          <span className="text-text-secondary">·</span>
          <span className="text-text-secondary">
            {card.match.duration} min
          </span>
        </div>
        <div className="flex items-center justify-between border-t border-border pt-3 text-[13px]">
          <div className="text-text-primary">
            <span className="font-semibold">
              {card.slots.filled} / {card.slots.capacity}
            </span>
            <span className="ml-2 text-text-secondary">
              {card.slots.free === 0
                ? "no spots left"
                : `${card.slots.free} ${card.slots.free === 1 ? "spot" : "spots"} open`}
            </span>
          </div>
          <span className="inline-flex items-center justify-center rounded-btn bg-green-dark px-3 py-1.5 text-[12px] font-semibold text-text-inverted shadow-btn">
            View match →
          </span>
        </div>
      </div>
    </Link>
  );
}

function formatCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `Starts in ${minutes}min`;
  return `Starts in ${hours}h ${minutes}min`;
}
