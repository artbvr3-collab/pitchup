/**
 * MODULE: app.matches.id.edit.page
 * PURPOSE: Server Component for `/matches/:id/edit` (captain edit). Resolves
 *          the session (requireAuth — onboarded users only), loads the
 *          match + venue, gates by `viewerRole === 'captain'` + live-status
 *          window, and hands the freshest `updated_at` snapshot to the
 *          client form (used as the optimistic-concurrency probe on PATCH).
 * LAYER: interfaces (Server Component)
 * INVARIANTS:
 *   - 404 when the match does not exist.
 *   - Redirect to `/matches/:id` when the viewer is NOT the captain (spec
 *     §626: "Others receive 403"; UX-wise the captain page is "back to
 *     match detail", a 403 page is overkill). Same redirect for non-live
 *     statuses (InProgress / Ended / Cancelled) — spec §628 says the
 *     server redirects back rather than rendering the form on a locked
 *     match.
 *   - `updated_at` is captured at RSC render time (NOT the polled state)
 *     because the edit form is independent of polling: the captain may
 *     load the form, sit for a minute, and submit; the OCC check under
 *     lock catches any concurrent edit.
 *   - Admin edit (Layer 9) will live at `/admin/matches/:id/edit` —
 *     separate page, separate auth gate, same `EditMatchService`.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id/edit"
 */
import { notFound, redirect } from "next/navigation";

import { requireAuth } from "@/src/auth/composition";
import { asUserId } from "@/src/auth/domain/user";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import { deriveMatchStatus } from "@/src/match_lifecycle/domain/match-status";
import { computeSlots } from "@/src/match_lifecycle/domain/slot-math";
import {
  joinRequestRepository,
  matchRepository,
  venueRepository,
} from "@/src/match_lifecycle/infrastructure/repositories";

import { EditMatchForm } from "./edit-form";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function EditMatchPage(props: PageProps) {
  const { id } = await props.params;
  const matchId = asMatchId(id);

  const session = await requireAuth();
  const viewerId = asUserId(session.userId);

  const match = await matchRepository.findById(matchId);
  if (!match) notFound();

  // Captain-only gate. Spec §626. Admins land here via a separate route
  // (Layer 9) so a non-captain non-admin sees the match page instead of a
  // permission-denied surface.
  if (match.captainId !== viewerId) {
    redirect(`/matches/${matchId}`);
  }

  // Live-status window — spec §628. InProgress / Ended / Cancelled cannot
  // be edited. For non-live we bounce back; the form is never rendered.
  const accepted =
    await joinRequestRepository.listAcceptedForMatch(matchId);
  let acceptedSlots = 0;
  for (const r of accepted) acceptedSlots += 1 + r.guestCount;
  const slots = computeSlots(match, acceptedSlots);
  const status = deriveMatchStatus(match, slots, new Date());
  if (status !== "open" && status !== "almostFull" && status !== "full") {
    redirect(`/matches/${matchId}`);
  }

  const venue = await venueRepository.findById(match.venueId);
  if (!venue) notFound();

  return (
    <main className="mx-auto flex max-w-[375px] flex-col gap-4 px-4 pb-12 pt-4">
      <header className="flex items-center gap-3">
        <a
          href={`/matches/${matchId}`}
          className="text-sm text-text-secondary hover:text-text-primary"
          aria-label="Back to match"
        >
          ← Back
        </a>
        <h1 className="text-base font-bold">Edit match</h1>
      </header>

      <EditMatchForm
        matchId={matchId}
        initial={{
          updatedAt: match.updatedAt.toISOString(),
          description: match.description,
          totalSpots: match.totalSpots,
          captainCrew: [...match.captainCrew],
          surface: match.surface,
          studsAllowed: match.studsAllowed,
          price: match.price,
          fieldBooked: match.fieldBooked,
          filled: slots.filled,
        }}
        venue={{
          name: venue.name,
          surfaces: [...venue.surface],
        }}
      />
    </main>
  );
}
