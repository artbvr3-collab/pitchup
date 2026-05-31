/**
 * MODULE: moderation.domain.report-repository
 * PURPOSE: Repository port for the `Report` aggregate. Domain owns the
 *          contract; infrastructure provides the Prisma adapter.
 * LAYER: domain
 * DEPENDENCIES: ./report
 * CONSUMED BY: src/moderation/application/*,
 *              src/moderation/infrastructure/prisma-report-repository.ts,
 *              the admin report routes (mark-reviewed / dismiss) via composition.
 * INVARIANTS:
 *   - `insertIfAbsent` is the ONLY write path for a NEW report and is
 *     dedup-aware: a row already matching the UNIQUE(reporter, type, targets)
 *     constraint yields `'duplicate'` with no INSERT (spec personal.md →
 *     "Submission modal" → silent dedup). Mirrors `ReminderSentRepository`.
 *   - `markAllNewReviewed` flips EVERY `new` row on the (type, targetId) target
 *     to `reviewed` — the spec's "a destructive [Review] action reviews all New
 *     reports on that target". `markDismissed` flips exactly ONE row by id.
 *   - `listAllForAdmin` is an unbounded-by-target read capped at `limit` rows
 *     (newest-first); the application layer groups by target in memory.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/reports",
 *               docs/ARCHITECTURE.md §8 (Persistence), ADR-0003.
 */
import type {
  NewReportInput,
  Report,
  ReportStatus,
  ReportType,
  SubmitReportOutcome,
} from "./report";

export interface ListReportsForAdminOptions {
  /** Optional type filter; `undefined` = both. */
  readonly type?: ReportType;
  /** Hard cap on rows scanned (newest-first). */
  readonly limit: number;
}

export interface ReportRepository {
  /**
   * Dedup-aware insert. Returns `'inserted'` on a fresh row, `'duplicate'`
   * when the UNIQUE constraint already holds (no new row, no error).
   */
  insertIfAbsent(input: NewReportInput): Promise<SubmitReportOutcome>;

  /**
   * All reports (newest-first, capped at `limit`) for the `/admin/reports`
   * list. The service groups them by target. Optional `type` filter applied
   * at the DB level.
   */
  listAllForAdmin(
    options: ListReportsForAdminOptions,
  ): Promise<readonly Report[]>;

  /** Single report by id, or `null`. Used by the dismiss route's 404 guard. */
  findById(id: string): Promise<Report | null>;

  /**
   * Flip every `status='new'` report on the target to `reviewed`, stamping
   * `reviewed_at = now` / `reviewed_by = reviewedBy`. `type` selects which
   * target column (`target_user_id` for player, `target_match_id` for match).
   * Returns the number of rows updated (0 is a legitimate no-op).
   */
  markAllNewReviewed(
    type: ReportType,
    targetId: string,
    reviewedBy: string,
    now: Date,
  ): Promise<number>;

  /**
   * Flip exactly one report (by id) to `dismissed`, stamping the reviewer.
   * Returns `false` if no row matched (the dismiss route maps that to 404).
   * Idempotent: dismissing an already-dismissed row re-stamps harmlessly.
   */
  markDismissed(
    reportId: string,
    reviewedBy: string,
    now: Date,
  ): Promise<boolean>;
}

/** Re-export for adapters/services that only need the value enums. */
export type { ReportStatus, ReportType };
