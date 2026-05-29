/**
 * MODULE: auth.domain.errors
 * PURPOSE: Domain errors specific to the auth bounded context. Codes are part
 *          of the public API contract — they appear in `{ code }` bodies
 *          returned by Route Handlers and drive client-side UX (toast text,
 *          modal state).
 * LAYER: domain
 * DEPENDENCIES: src/shared/errors/app-error
 * CONSUMED BY: src/auth/application/*, src/shared/errors/http-mapping
 * INVARIANTS:
 *   - One concrete class per spec error code (no overloaded codes via `meta`).
 *   - `UnauthorizedError` lives in `src/shared/errors/app-error.ts` because
 *     `requireAuth()` predates the auth-domain error file; do not move it.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "Admin role management & safety"
 *     ("last-admin guard"), "ACCOUNT ACTIONS" → Delete account → last-admin
 *     branch
 */
import { AppError } from "@/src/shared/errors/app-error";

/**
 * `409 last_admin` — caller (the user themselves via `DELETE /api/me` in
 * Layer 7.5, an admin via `POST /admin/users/:id/demote` or `.../ban` in
 * Layer 9) would leave the system with zero active admins. Spec personal.md
 * predicate: `target.isAdmin === true && count(isAdmin=true, banned=false,
 * deletedAt IS NULL) === 1`. UI mirrors the guard by disabling the action
 * button + blocking text in the confirm modal; the 409 is the canonical
 * backstop against direct curl / desynced UI.
 */
export class LastAdminError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super(
      "last_admin",
      "Cannot delete the only remaining admin. Promote someone else first.",
      409,
      meta,
    );
  }
}
