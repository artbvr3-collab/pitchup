/**
 * MODULE: app.matches.id.page
 * PURPOSE: Server Component for `/matches/:id`. Resolves the optional
 *          session, fetches the match + viewer's join-request + initial
 *          state via composition-root services, derives the viewer role,
 *          and hands the snapshot to the client islands (CTA bar, tabs,
 *          captain sheet). Guests are first-class — the page renders for
 *          them; only the polling endpoint enforces membership.
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition.optionalAuth,
 *               src/match_lifecycle/composition,
 *               src/match_lifecycle/infrastructure/repositories,
 *               src/match_lifecycle/domain/viewer-role,
 *               src/auth/domain/user, ./match-shell
 * INVARIANTS:
 *   - 404 when match id does not exist (Next.js notFound() — middleware
 *     does NOT gate this route; spec says direct match links keep working
 *     even for cancelled matches).
 *   - `viewerRole` is derived ONCE here and passed down — never re-derived
 *     in client islands (the cascade only depends on three inputs).
 *   - `generateMetadata` returns OG tags. The cover image stays minimal in
 *     Layer 5 (placeholder gradient mockup); real venue covers land later.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id"
 *   - docs/spec/pitchup-spec-global.md → "Authentication" (optional session)
 */
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { optionalAuth } from "@/src/auth/composition";
import { matchStateService } from "@/src/match_lifecycle/composition";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import { deriveViewerRole } from "@/src/match_lifecycle/domain/viewer-role";
import { asUserId } from "@/src/auth/domain/user";
import {
  joinRequestRepository,
  matchRepository,
  venueRepository,
  watchRepository,
} from "@/src/match_lifecycle/infrastructure/repositories";

import { MatchShell } from "./match-shell";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata(
  props: PageProps,
): Promise<Metadata> {
  const { id } = await props.params;
  const match = await matchRepository.findById(asMatchId(id));
  if (!match) return { title: "Match not found · PITCHUP" };
  const venue = await venueRepository.findById(match.venueId);
  const title = venue ? `${venue.name} · PITCHUP` : "Match · PITCHUP";
  const desc = venue
    ? `Pickup football at ${venue.name}, ${venue.address}.`
    : "Pickup football match";
  return {
    title,
    description: desc,
    openGraph: { title, description: desc },
  };
}

export default async function MatchPage(props: PageProps) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const matchId = asMatchId(id);

  const session = await optionalAuth();
  const viewerId = session ? asUserId(session.userId) : null;

  const match = await matchRepository.findById(matchId);
  if (!match) notFound();

  const venue = await venueRepository.findById(match.venueId);
  if (!venue) {
    // Defensive: a match referencing a missing venue is corruption — treat
    // as 404 for UX rather than crashing the page.
    notFound();
  }

  // Viewer-role derivation: needs the viewer's own JoinRequest + Watch row.
  const [viewerJoinRequest, isWatching] = viewerId
    ? await Promise.all([
        joinRequestRepository.findByMatchAndUser(matchId, viewerId),
        watchRepository.existsForUserAndMatch(matchId, viewerId),
      ])
    : [null, false];

  const viewerRole = deriveViewerRole({
    match,
    viewerId,
    joinRequest: viewerJoinRequest,
    isWatching,
  });

  // Initial state snapshot — same DTO the polling endpoint returns. Client
  // islands hydrate from it without an extra request.
  const initialState = await matchStateService.execute(
    { matchId, viewerId, since: null },
    new Date(),
  );

  // Parse query-string deep links per spec:
  //   ?tab=chat       → open chat tab by default
  //   ?sheet=captain  → auto-open captain sheet (only honoured if captain)
  const requestedTab = pickString(sp.tab);
  const requestedSheet = pickString(sp.sheet);
  const initialTab = requestedTab === "chat" ? "chat" : "lineup";
  const autoOpenCaptainSheet =
    requestedSheet === "captain" && viewerRole === "captain";

  return (
    <MatchShell
      matchId={matchId}
      venue={{
        name: venue.name,
        address: venue.address,
        googleMapsUrl: venue.googleMapsUrl,
      }}
      match={{
        id: match.id,
        coverId: match.coverId,
        startTime: match.startTime.toISOString(),
        duration: match.duration,
        totalSpots: match.totalSpots,
        price: match.price,
        surface: match.surface,
        studsAllowed: match.studsAllowed,
        fieldBooked: match.fieldBooked,
        description: match.descriptionHidden ? null : match.description,
        cancelReason: match.cancelReasonHidden ? null : match.cancelReason,
        captainCrew: [...match.captainCrew],
      }}
      viewerRole={viewerRole}
      viewerId={viewerId}
      initialState={initialState}
      initialTab={initialTab}
      autoOpenCaptainSheet={autoOpenCaptainSheet}
    />
  );
}

function pickString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}
