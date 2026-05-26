/**
 * MODULE: app.(private).matches.new.page
 * PURPOSE: Server-Component shell for the Create-match wizard. Calls
 *          `requireAuth()` (the captain is the current session) and loads
 *          the active-venue list (spec: "venue directory is admin-managed").
 *          All interactive state lives in the client `<Wizard>`.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition, src/match_lifecycle/composition,
 *               ./wizard
 * INVARIANTS:
 *   - Guests are bounced by middleware before they reach here. The page
 *     itself still calls `requireAuth()` as a backstop (defence in depth).
 *   - The venue list is fetched server-side on every load (`dynamic = "force-
 *     dynamic"`); admin-deactivated venues must not appear in the picker.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "/matches/new — Create match"
 */
import { requireAuth } from "@/src/auth/composition";
import { listVenuesService } from "@/src/match_lifecycle/composition";
import { Wizard } from "./wizard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewMatchPage() {
  await requireAuth();
  const venues = await listVenuesService.execute();

  return <Wizard venues={venues} nowIso={new Date().toISOString()} />;
}
