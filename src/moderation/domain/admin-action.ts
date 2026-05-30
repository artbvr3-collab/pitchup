/**
 * MODULE: moderation.domain.admin-action
 * PURPOSE: The `AdminAction` audit entity + its action enum. One row per
 *          admin role/ban operation in `/admin/users` — the append-only trail
 *          read directly from the DB for appeals / investigations (spec
 *          personal.md → "Audit log").
 * LAYER: domain (pure — no I/O, no Prisma)
 * DEPENDENCIES: none (stdlib types only)
 * CONSUMED BY: src/moderation/domain/admin-action-repository.ts,
 *              src/moderation/application/*, src/moderation/infrastructure/*
 * INVARIANTS:
 *   - `action` is one of the four canonical strings; the persistence column is
 *     a plain TEXT (app-validated enum), not a Postgres enum — same convention
 *     as `Notification.type`.
 *   - `reason` is required (non-empty) for promote/demote/ban and `null` for
 *     unban (no reason modal in the spec). Enforcement lives at the HTTP
 *     boundary + the service, not here.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "Admin role management &
 *               safety" → "Audit log".
 */

export type AdminActionType = "promote" | "demote" | "ban" | "unban";

/** What the repository persists. Ids are raw strings at this boundary —
 *  the moderation context does not own the User branded-id type. */
export interface RecordAdminActionInput {
  readonly actorAdminId: string;
  readonly targetUserId: string;
  readonly action: AdminActionType;
  readonly reason: string | null;
}
