/**
 * MODULE: moderation.domain.errors
 * PURPOSE: Domain errors specific to the moderation bounded context. Codes are
 *          part of the public API contract — they appear in `{ code }` bodies
 *          from the `/api/admin/**` Route Handlers and drive the admin UI
 *          (toast text, disabled-button mirrors).
 * LAYER: domain
 * DEPENDENCIES: src/shared/errors/app-error
 * CONSUMED BY: src/moderation/application/*, src/shared/errors/http-mapping
 * INVARIANTS:
 *   - One concrete class per spec error code.
 *   - The last-admin guard reuses `LastAdminError` (code `last_admin`) from the
 *     auth context — same predicate, same code; do NOT define a second one here.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "Admin role management & safety"
 *     (self-modification guard, last-admin guard)
 */
import { AppError } from "@/src/shared/errors/app-error";

/**
 * `403 self_modification` — an admin tried to ban / demote / promote their own
 * account. Spec personal.md: "if (target_id === current_admin_id) → reject
 * 'You cannot modify your own account'". The UI disables the buttons on the
 * `(you)` row; this is the backstop against direct curl / a desynced tab.
 */
export class SelfModificationError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super(
      "self_modification",
      "You cannot modify your own account",
      403,
      meta,
    );
  }
}

/**
 * `404 user_not_found` — the target of an admin action does not exist (a
 * deleted-then-purged row, or a fabricated id in a direct API call). The admin
 * table only ever links real rows, so this is a curl / race path.
 */
export class AdminTargetNotFoundError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("user_not_found", "Target user not found", 404, meta);
  }
}

/**
 * `404 report_target_not_found` — `POST /api/reports` named a match or player
 * that does not exist (or, for a player, is banned / soft-deleted — outside
 * observers cannot tell, mirroring the `/users/:id` privacy sentinel). The UI
 * never offers Report on a removed target; this is the curl / stale-tab path.
 */
export class ReportTargetNotFoundError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("report_target_not_found", "Report target not found", 404, meta);
  }
}

/**
 * `400 cannot_report_self` — a signed-in user tried to report their own
 * profile. The `/users/:id` page redirects self-views to `/me` (the `[⋯]`
 * menu never renders for the owner); this is the direct-API backstop.
 */
export class CannotReportSelfError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("cannot_report_self", "You cannot report yourself", 400, meta);
  }
}

/**
 * `404 report_not_found` — an admin `[Dismiss]` targeted a report id that
 * does not exist (already purged, or a fabricated id). The list only links
 * real rows, so this is a race / curl path.
 */
export class ReportNotFoundError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("report_not_found", "Report not found", 404, meta);
  }
}
