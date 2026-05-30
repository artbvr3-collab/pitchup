/**
 * MODULE: app.admin.matches.id.edit.page
 * PURPOSE: Server Component for `/admin/matches/:id/edit`. Admin-gated variant
 *          of the captain edit page. Uses the same `EditMatchForm` client
 *          island but submits to `PATCH /api/admin/matches/:id` (admin endpoint)
 *          instead of `PATCH /api/matches/:id`, bypassing the captain check.
 * LAYER: interfaces (Server Component)
 * INVARIANTS:
 *   - `requireAdminPage()` gate — guest → /login, non-admin → /my-matches.
 *   - 404 when the match does not exist.
 *   - Admin can edit live statuses only (Open / AlmostFull / Full), same as the
 *     captain. Spec personal.md: "For In progress / Ended / Cancelled the [Edit]
 *     button is disabled (same restriction as for the captain)."
 *   - No captain check (admin can edit any match).
 *   - `updated_at` captured at RSC render time — OCC probe on the PATCH.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → Edit
 *   - app/matches/[id]/edit/page.tsx (captain variant)
 */
import { notFound, redirect } from "next/navigation";

import { requireAdminPage } from "@/src/auth/composition";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import { deriveMatchStatus } from "@/src/match_lifecycle/domain/match-status";
import { computeSlots } from "@/src/match_lifecycle/domain/slot-math";
import {
  joinRequestRepository,
  matchRepository,
  venueRepository,
} from "@/src/match_lifecycle/infrastructure/repositories";
import { EditMatchForm } from "@/app/matches/[id]/edit/edit-form";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function AdminEditMatchPage(props: PageProps) {
  const { id } = await props.params;
  const matchId = asMatchId(id);

  await requireAdminPage();

  const match = await matchRepository.findById(matchId);
  if (!match) notFound();

  // Live-status window only — same restriction as captain edit.
  const accepted = await joinRequestRepository.listAcceptedForMatch(matchId);
  let acceptedSlots = 0;
  for (const r of accepted) acceptedSlots += 1 + r.guestCount;
  const slots = computeSlots(match, acceptedSlots);
  const status = deriveMatchStatus(match, slots, new Date());
  if (status !== "open" && status !== "almostFull" && status !== "full") {
    redirect(`/admin/matches`);
  }

  const venue = await venueRepository.findById(match.venueId);
  if (!venue) notFound();

  return (
    <main className="mx-auto flex max-w-[375px] flex-col gap-4 px-4 pb-12 pt-4">
      <header className="flex items-center gap-3">
        <a
          href="/admin/matches"
          className="text-sm text-text-secondary hover:text-text-primary"
          aria-label="Back to admin matches"
        >
          ← Back
        </a>
        <h1 className="text-base font-bold">Edit match (admin)</h1>
      </header>

      <EditMatchForm
        matchId={matchId}
        submitUrl={`/api/admin/matches/${matchId}`}
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
