/**
 * MODULE: app.(private).my-matches.page
 * PURPOSE: Layer-6 /my-matches Server Component. Composes ListMyMatchesService
 *          into three sections (Captain / Upcoming / Past) + a featured
 *          "Your next match" card on top of Upcoming. Empty sections are
 *          not rendered; if all three are empty, the page shows the
 *          spec-defined empty state with two CTAs.
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (requireAuth),
 *               src/match_lifecycle/composition (listMyMatchesService),
 *               src/match_lifecycle/application/discover-filters (encodeCursor)
 * INVARIANTS:
 *   - Auth-only (spec personal.md "/my-matches content is auth-only").
 *     Uses `requireAuth` (throwing); middleware/onboarding guard already
 *     redirects guests to /login?callbackUrl=/my-matches.
 *   - The featured "Your next match" card is the first item in
 *     `upcoming` after sorting `start_time ASC`. If `upcoming` is empty
 *     the featured slot is absent.
 *   - Captain cards link to `/matches/:id?sheet=captain` for live matches
 *     (auto-opens captain sheet) and `/matches/:id` for InProgress (sheet
 *     unavailable after start; spec personal.md "/my-matches → Section
 *     Captain").
 *   - Section Past is initial-render only here; the client island
 *     `PastListWithShowMore` owns subsequent pagination via
 *     `GET /api/my-matches/past?cursor=`.
 *   - Live updates: Layer 7's SignedInChrome polls `GET /api/updates/state`
 *     and calls `router.refresh()` when `matches_changed` is non-empty, which
 *     re-runs this RSC. Watching-card staleness remains acceptable per spec
 *     personal.md (watching transitions are excluded from `matches_changed`).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/my-matches"
 *   - docs/ROADMAP.md → Layer 6
 */
import Link from "next/link";

import { requireAuth } from "@/src/auth/composition";
import { encodeCursor } from "@/src/match_lifecycle/application/discover-filters";
import type { MyMatchCardDto } from "@/src/match_lifecycle/application/dto/my-matches";
import { listMyMatchesService } from "@/src/match_lifecycle/composition";

import { FeaturedNextMatchCard } from "./featured-next-match-card";
import { MyMatchCard } from "./my-match-card";
import {
  PastListWithShowMore,
  type PastListInitialState,
  type PastWireRow,
} from "./past-list-with-show-more";

export const dynamic = "force-dynamic";

export default async function MyMatchesPage() {
  const me = await requireAuth();
  const now = new Date();
  const page = await listMyMatchesService.execute({ userId: me.userId }, now);

  const hasContent =
    page.captain.length > 0 ||
    page.upcoming.length > 0 ||
    page.past.length > 0;

  if (!hasContent) {
    return <EmptyState />;
  }

  const featured = page.upcoming[0] ?? null;
  const upcomingRest = featured ? page.upcoming.slice(1) : [];

  const pastInitial: PastListInitialState = {
    rows: page.past.map(toWireRow),
    nextCursor: page.pastCursor ? encodeCursor(page.pastCursor) : null,
  };

  const reminderIds = page.likesReminder.map((r) => r.matchId);

  return (
    <main className="mx-auto w-full max-w-[375px] px-4 pb-12 pt-4">
      <h1 className="mb-4 text-[22px] font-bold leading-tight tracking-tight text-text-primary">
        My matches
      </h1>

      {reminderIds.length > 0 && <LikesReminder matchIds={reminderIds} />}

      {page.captain.length > 0 && (
        <section className="mb-6">
          <SectionHeader title="Captain" />
          <div className="space-y-3">
            {page.captain.map((card) => (
              <MyMatchCard key={card.match.id} card={card} variant="captain" />
            ))}
          </div>
        </section>
      )}

      {page.upcoming.length > 0 && (
        <section className="mb-6">
          <SectionHeader title="Upcoming" />
          {featured && (
            <div className="mb-3">
              <FeaturedNextMatchCard card={featured} now={now} />
            </div>
          )}
          {upcomingRest.length > 0 && (
            <div className="space-y-3">
              {upcomingRest.map((card) => (
                <MyMatchCard
                  key={card.match.id}
                  card={card}
                  variant="upcoming"
                />
              ))}
            </div>
          )}
        </section>
      )}

      {page.past.length > 0 && (
        <section id="past-section" className="mb-6 scroll-mt-4">
          <SectionHeader title="Past" />
          <PastListWithShowMore
            initial={pastInitial}
            awaitingLikeIds={reminderIds.length >= 2 ? reminderIds : []}
          />
        </section>
      )}
    </main>
  );
}

/**
 * Likes reminder (spec personal.md → "Likes reminder section"). One Ended
 * match awaiting likes → a direct "[Open]" link to it. Two or more → a single
 * line that scrolls to Section Past, where each awaiting card carries an
 * "Awaiting likes" badge.
 */
function LikesReminder({ matchIds }: { matchIds: readonly string[] }) {
  if (matchIds.length === 1) {
    return (
      <Link
        href={`/matches/${matchIds[0]}?action=likes`}
        className="mb-6 flex items-center justify-between gap-3 rounded-card border border-lime bg-lime/15 px-4 py-3"
      >
        <span className="text-[14px] font-medium text-text-primary">
          👍 1 match awaits your likes
        </span>
        <span className="text-[14px] font-semibold text-green-dark">
          Open →
        </span>
      </Link>
    );
  }
  return (
    <a
      href="#past-section"
      className="mb-6 flex items-center justify-between gap-3 rounded-card border border-lime bg-lime/15 px-4 py-3"
    >
      <span className="text-[14px] font-medium text-text-primary">
        👍 {matchIds.length} matches await your likes
      </span>
      <span className="text-[14px] font-semibold text-green-dark">View →</span>
    </a>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
      {title}
    </h2>
  );
}

function EmptyState() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[375px] flex-col items-center justify-center px-6 text-center">
      <div className="text-[60px] leading-none" aria-hidden>
        ⚽
      </div>
      <h1 className="mt-4 text-[22px] font-bold tracking-tight text-text-primary">
        No matches yet
      </h1>
      <p className="mt-2 text-[14px] text-text-secondary">
        Find a pickup match nearby, or organise your own.
      </p>
      <div className="mt-6 flex w-full flex-col gap-3">
        <Link
          href="/games"
          className="inline-flex h-12 items-center justify-center rounded-btn bg-green-dark px-6 text-[15px] font-semibold text-text-inverted shadow-btn transition-colors hover:bg-green-mid"
        >
          Find a match →
        </Link>
        <Link
          href="/matches/new"
          className="inline-flex h-12 items-center justify-center rounded-btn border border-border-strong bg-bg-card px-6 text-[15px] font-semibold text-text-primary transition-colors hover:bg-bg-card-dim"
        >
          + New match
        </Link>
      </div>
    </main>
  );
}

function toWireRow(card: MyMatchCardDto): PastWireRow {
  return {
    match_id: card.match.id,
    cover_id: card.match.coverId,
    venue_name: card.match.venue.name,
    venue_address: card.match.venue.address,
    start_time: card.match.startTime.toISOString(),
    duration: card.match.duration,
    surface: card.match.surface,
    studs_allowed: card.match.studsAllowed,
    field_booked: card.match.fieldBooked,
    price: card.match.price,
    slots: card.slots,
    match_status: card.matchStatus,
    my_status: card.myStatus,
    is_captain: card.isCaptain,
    join_request_status: card.joinRequestStatus,
    join_request_auto_reason: card.joinRequestAutoReason,
  };
}
