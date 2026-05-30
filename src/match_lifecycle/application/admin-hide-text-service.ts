/**
 * MODULE: match_lifecycle.application.admin-hide-text-service
 * PURPOSE: Use case — admin toggles `description_hidden` and/or
 *          `cancel_reason_hidden` on a match for content moderation.
 *          Implements `PATCH /api/admin/matches/:id/hide-text`. No advisory
 *          lock (admin single-tab; flags have no slot/status invariants).
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository
 * CONSUMED BY: app/api/admin/matches/[id]/hide-text/route.ts
 * INVARIANTS:
 *   - Either flag can be toggled independently. `undefined` means "don't touch".
 *   - Available for ALL match statuses — this is an intentional exception to
 *     the "no changes after start" rule (content moderation ≠ content editing,
 *     spec personal.md → "Hide text").
 *   - No audit row in v1 (spec personal.md → "Hide text" → "An audit log of
 *     hide operations is not built in v1").
 *   - Original text is preserved in the DB (the hide flag just gates display).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → "Hide text"
 */
import { asMatchId } from "../domain/match";
import type { MatchRepository, UpdateMatchFlags } from "../domain/match-repository";
import { MatchNotFoundError } from "../domain/errors";

export interface AdminHideTextInput {
  readonly matchId: string;
  readonly descriptionHidden?: boolean;
  readonly cancelReasonHidden?: boolean;
}

export interface AdminHideTextResult {
  readonly descriptionHidden: boolean;
  readonly cancelReasonHidden: boolean;
}

export class AdminHideTextService {
  constructor(private readonly matchRepository: MatchRepository) {}

  async execute(input: AdminHideTextInput): Promise<AdminHideTextResult> {
    const matchId = asMatchId(input.matchId);
    const flags: UpdateMatchFlags = {
      ...(input.descriptionHidden !== undefined
        ? { descriptionHidden: input.descriptionHidden }
        : {}),
      ...(input.cancelReasonHidden !== undefined
        ? { cancelReasonHidden: input.cancelReasonHidden }
        : {}),
    };

    const result = await this.matchRepository.updateFlags(matchId, flags);
    if (!result) throw new MatchNotFoundError({ matchId });
    return result;
  }
}
