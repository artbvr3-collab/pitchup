/**
 * MODULE: app.(private).my-matches.my-match-card
 * PURPOSE: Per-row card for /my-matches sections. Wraps the canonical
 *          MatchCard with my-matches-specific badges (Captain, You're in,
 *          Waiting…, 👀 Watching) and the Past sub-label. The wrapper
 *          chooses the link target — captain live → `?sheet=captain`,
 *          captain InProgress → no sheet, everyone else → plain match page.
 * LAYER: interfaces (Server Component — pure presentational, no state)
 * DEPENDENCIES: ./my-matches-types (PastWireRow shape — reused for SSR),
 *               src/ui/components/match-card
 * INVARIANTS:
 *   - Past sub-label is derived from `joinRequestStatus` + `auto_reason` +
 *     `isCaptain`, NOT from `my_status` (spec personal.md table — three
 *     `auto_reason` values map to different labels but to the same
 *     `declined`).
 *   - Captain section card carries the `Captain` badge + (if applicable)
 *     the `N pending` orange badge. Other sections never show these.
 *   - The card link target encodes the spec rule "auto-open captain sheet
 *     via ?sheet=captain" — only for captain on live (Open / AlmostFull /
 *     Full). InProgress drops the parameter (sheet unavailable).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/my-matches"
 *   - docs/spec/pitchup-spec-match.md → captain sheet auto-open via
 *     `?sheet=captain`
 */
import type { MyMatchCardDto } from "@/src/match_lifecycle/application/dto/my-matches";
import { MatchCard } from "@/src/ui/components/match-card";
import { cn } from "@/src/ui/lib/cn";

export type SectionVariant = "captain" | "upcoming" | "past";

export interface MyMatchCardProps {
  readonly card: MyMatchCardDto;
  readonly variant: SectionVariant;
}

export function MyMatchCard({ card, variant }: MyMatchCardProps) {
  const href = pickHref(card);
  const badges = pickBadges(card, variant);
  const pastSubLabel =
    variant === "past" ? derivePastSubLabel(card) : null;

  return (
    <div>
      {badges.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
          {badges.map((b, i) => (
            <Badge key={i} label={b.label} tone={b.tone} />
          ))}
        </div>
      )}
      <MatchCard
        href={href}
        venueName={card.match.venue.name}
        venueAddress={card.match.venue.address}
        startTime={card.match.startTime}
        duration={card.match.duration}
        surface={card.match.surface}
        studsAllowed={card.match.studsAllowed}
        fieldBooked={card.match.fieldBooked}
        price={card.match.price}
        status={card.matchStatus}
        slots={card.slots}
      />
      {pastSubLabel && (
        <div className="mt-1 px-1 text-[12px] text-text-secondary">
          {pastSubLabel}
        </div>
      )}
    </div>
  );
}

function pickHref(card: MyMatchCardDto): string {
  if (card.isCaptain && isLive(card.matchStatus)) {
    return `/matches/${card.match.id}?sheet=captain`;
  }
  return `/matches/${card.match.id}`;
}

interface BadgeSpec {
  readonly label: string;
  readonly tone: "captain" | "accepted" | "pending" | "watching" | "alert";
}

function pickBadges(
  card: MyMatchCardDto,
  variant: SectionVariant,
): readonly BadgeSpec[] {
  const out: BadgeSpec[] = [];

  if (card.isCaptain && variant !== "upcoming") {
    out.push({ label: "Captain", tone: "captain" });
  }

  if (variant === "captain" && card.pendingCount && card.pendingCount > 0) {
    out.push({
      label: `${card.pendingCount} pending`,
      tone: "alert",
    });
  }

  if (variant === "upcoming") {
    if (card.myStatus === "accepted") {
      out.push({ label: "You're in ✓", tone: "accepted" });
    } else if (card.myStatus === "pending") {
      out.push({ label: "Waiting…", tone: "pending" });
    } else if (card.myStatus === "watching") {
      out.push({ label: "👀 Watching", tone: "watching" });
    }
  }

  return out;
}

/**
 * Spec personal.md "/my-matches → Section Past" sub-label table. Reads
 * JoinRequest.status directly (NOT my_status) since `declined` collapses
 * three different `auto_reason` values that render different copy.
 */
function derivePastSubLabel(card: MyMatchCardDto): string | null {
  // Captain past — no role-based sub-label, just the optional Captain badge.
  if (card.isCaptain) return null;

  const status = card.joinRequestStatus;
  if (!status) return null;

  if (status === "accepted") {
    return card.matchStatus === "cancelled" ? "Match was cancelled" : "Played";
  }
  if (status === "left") return "You left";
  if (status === "kicked") return "You were removed";
  if (status === "cancelled") return "You cancelled your request";
  if (status === "rejected") {
    switch (card.joinRequestAutoReason) {
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

function isLive(
  status: MyMatchCardDto["matchStatus"],
): status is "open" | "almostFull" | "full" {
  return status === "open" || status === "almostFull" || status === "full";
}

function Badge({ label, tone }: BadgeSpec) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-badge px-2 py-0.5 text-[11px] font-semibold",
        TONE_CLASS[tone],
      )}
    >
      {label}
    </span>
  );
}

const TONE_CLASS: Record<BadgeSpec["tone"], string> = {
  captain: "bg-green-dark text-text-inverted",
  accepted: "bg-lime text-lime-text",
  pending: "bg-bg-surface text-text-secondary border border-border-strong",
  watching: "bg-bg-surface text-text-primary border border-border-strong",
  alert: "bg-status-almost text-text-inverted",
};
