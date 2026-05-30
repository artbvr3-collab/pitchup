/**
 * MODULE: match_lifecycle.application.list-admin-matches-service
 * PURPOSE: Assembles the admin match list for `/admin/matches`. Fetches up to
 *          200 matches (any status, sorted start_time DESC), derives each
 *          match's on-read status, applies the optional status filter, and
 *          returns a flat DTO array ready for the admin table RSC.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository
 * CONSUMED BY: app/admin/matches/page.tsx
 * INVARIANTS:
 *   - Status is computed on-read via `deriveMatchStatus` (no DB status column).
 *   - Status filter is applied in memory after fetch — ≤200 rows is acceptable.
 *   - No advisory lock — pure read.
 *   - The "participants" column = captain (1) + captainCrew.length + acceptedCount.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches"
 *   - docs/spec/pitchup-spec-global.md → "Match states"
 */
import { deriveMatchStatus } from "../domain/match-status";
import type { AdminMatchRow, MatchRepository } from "../domain/match-repository";
import { computeSlots } from "../domain/slot-math";

/** Domain status values (from `deriveMatchStatus` — lowercase / camelCase). */
export type AdminMatchStatus =
  | "open"
  | "almostFull"
  | "full"
  | "inProgress"
  | "ended"
  | "cancelled";

export interface AdminMatchView extends AdminMatchRow {
  readonly status: AdminMatchStatus;
  /** Captain + captain_crew + accepted (including guest seats). */
  readonly participants: number;
}

export interface ListAdminMatchesInput {
  readonly search: string;
  /** Empty = all statuses. Must be values from AdminMatchStatus. */
  readonly statusFilter: readonly AdminMatchStatus[];
  readonly now: Date;
}

export class ListAdminMatchesService {
  static readonly LIMIT = 200;

  constructor(private readonly matchRepository: MatchRepository) {}

  async execute(input: ListAdminMatchesInput): Promise<readonly AdminMatchView[]> {
    const rows = await this.matchRepository.findForAdmin({
      now: input.now,
      search: input.search,
      statusFilter: [...input.statusFilter],
      limit: ListAdminMatchesService.LIMIT,
    });

    const views: AdminMatchView[] = rows.map((row) => {
      const slots = computeSlots(
        {
          totalSpots: row.totalSpots,
          // Stub crew array of the right length — computeSlots only needs the
          // length, not the actual names.
          captainCrew: Array(row.captainCrewLength).fill(""),
          // Other fields not used by computeSlots are omitted safely via cast.
        } as Parameters<typeof computeSlots>[0],
        row.acceptedCount,
      );
      const status = deriveMatchStatus(
        {
          startTime: row.startTime,
          duration: row.duration,
          cancelledAt: row.cancelledAt,
        } as Parameters<typeof deriveMatchStatus>[0],
        slots,
        input.now,
      ) as AdminMatchStatus;
      const participants = 1 + row.captainCrewLength + row.acceptedCount;
      return { ...row, status, participants };
    });

    if (input.statusFilter.length === 0) return views;
    const allowed = new Set<string>(input.statusFilter);
    return views.filter((v) => allowed.has(v.status));
  }
}
