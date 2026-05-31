/**
 * MODULE: moderation.domain.report
 * PURPOSE: The `Report` entity + its type/status enums and the persistence
 *          input shape. A report is a user-submitted abuse flag on a match or
 *          a player; the admin works through them in `/admin/reports`.
 * LAYER: domain (pure — no I/O, no Prisma)
 * DEPENDENCIES: none (stdlib types only)
 * CONSUMED BY: src/moderation/domain/report-repository.ts,
 *              src/moderation/application/*, src/moderation/infrastructure/*
 * INVARIANTS:
 *   - `type` is one of the two canonical strings; the column is a plain TEXT
 *     app-validated enum (same convention as `AdminAction.action`).
 *   - Exactly one of `targetMatchId` / `targetUserId` is non-null and matches
 *     `type` — enforced by `SubmitReportService`, not a DB CHECK. A row whose
 *     target became null is an ORPHAN (the match was admin hard-deleted, Layer
 *     9c; `onDelete: SetNull`) — the report survives for the audit trail.
 *   - `status` per-row ladder: `new` → `reviewed` (a `[Review]` destructive
 *     action) or `new`/`reviewed` → `dismissed` (an explicit `[Dismiss]`).
 *   - Ids are raw strings at this boundary — the moderation context does not
 *     own the User / Match branded-id types.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/reports"
 *   - docs/spec/pitchup-app-map.md → "Report"
 */

export type ReportType = "match" | "player";

export type ReportStatus = "new" | "reviewed" | "dismissed";

/** Full persisted shape, as read back from the repository. */
export interface Report {
  readonly id: string;
  readonly reporterId: string;
  readonly type: ReportType;
  readonly targetMatchId: string | null;
  readonly targetUserId: string | null;
  readonly comment: string;
  readonly status: ReportStatus;
  readonly createdAt: Date;
  readonly reviewedAt: Date | null;
  readonly reviewedBy: string | null;
}

/** What the repository inserts on a new report (status defaults to `new`). */
export interface NewReportInput {
  readonly reporterId: string;
  readonly type: ReportType;
  readonly targetMatchId: string | null;
  readonly targetUserId: string | null;
  readonly comment: string;
}

/** Outcome of the dedup-aware insert (spec: repeat report → 200, no new row). */
export type SubmitReportOutcome = "inserted" | "duplicate";
