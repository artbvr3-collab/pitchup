/**
 * MODULE: app.(public).games.page
 * PURPOSE: Public Discover feed. Lists upcoming matches sorted by start time,
 *          rendered as MatchCards. Layer 2 scope is read-only and unfiltered
 *          — day picker, distance / time / size / spots filters, search,
 *          and cursor pagination land in Layer 2.5.
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/match_lifecycle/composition.ts, src/ui/components/*
 * INVARIANTS:
 *   - Accessible to guests (no auth gate). Middleware whitelists `/games`.
 *   - Cancelled matches and past matches are excluded by the repository.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games",
 *               docs/ROADMAP.md → Layer 2.
 */
import { listDiscoverMatchesService } from "@/src/match_lifecycle/composition";
import { MatchCard } from "@/src/ui/components/match-card";

export const dynamic = "force-dynamic";

export default async function GamesPage() {
  const matches = await listDiscoverMatchesService.execute({ limit: 50 });

  return (
    <main className="px-4 py-6">
      <header className="mb-4">
        <h1 className="text-[20px] font-semibold text-text-primary">
          Discover
        </h1>
        <p className="mt-1 text-[13px] text-text-secondary">
          {matches.length === 0
            ? "No upcoming matches right now."
            : `${matches.length} upcoming ${matches.length === 1 ? "match" : "matches"}`}
        </p>
      </header>

      {matches.length === 0 ? (
        <div className="rounded-card border border-border bg-bg-card p-6 text-center text-[13px] text-text-secondary">
          Check back soon, or be the first to create one.
        </div>
      ) : (
        <ul className="space-y-3">
          {matches.map((match) => (
            <li key={match.id}>
              <MatchCard
                href={`/matches/${match.id}`}
                venueName={match.venue.name}
                venueAddress={match.venue.address}
                startTime={match.startTime}
                duration={match.duration}
                surface={match.surface}
                studsAllowed={match.studsAllowed}
                fieldBooked={match.fieldBooked}
                price={match.price}
                coverId={match.coverId}
                status={match.status}
                slots={{
                  filled: match.slots.filled,
                  capacity: match.slots.capacity,
                  free: match.slots.free,
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
