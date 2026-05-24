/**
 * MODULE: shared.errors.app-error
 * PURPOSE: Base error class and the subclasses Layer 1 needs. The full
 *          hierarchy (DomainError + match-specific errors, NotFoundError,
 *          ForbiddenError, InfrastructureError) lands in later layers when
 *          first used — see docs/ARCHITECTURE.md §6 for the planned tree.
 * LAYER: shared / domain
 * DEPENDENCIES: none
 * CONSUMED BY: src/auth/application/require-auth.ts, future Route Handlers,
 *              shared/errors/http-mapping.ts (to be added with first
 *              Route Handler in Layer 3).
 * INVARIANTS:
 *   - Every thrown error in the app extends AppError.
 *   - `code` is a stable machine-readable string for the API contract.
 *   - `message` is internal — never displayed verbatim to end users.
 * RELATED DOCS: docs/ARCHITECTURE.md §6 (Errors), CODING_STANDARDS.md §8.
 */

export class AppError extends Error {
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly meta: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    httpStatus: number,
    meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.meta = meta;
  }
}

/**
 * Thrown by `requireAuth()` when no valid session is present, the user row
 * is missing (onboarding not completed), the user is banned, or the account
 * is soft-deleted. The `code` distinguishes these cases for the client
 * redirect logic — see docs/spec/pitchup-spec-global.md "Session invalidation".
 */
export class UnauthorizedError extends AppError {
  constructor(
    code: "no_session" | "user_not_found" | "banned" | "deleted",
    meta: Record<string, unknown> = {},
  ) {
    super(code, "Unauthorized", 401, meta);
  }
}

/**
 * Thrown when input fails Zod validation. The `meta` field carries the
 * flattened field errors so the HTTP mapper can return them to the client.
 */
export class ValidationError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("validation_failed", "Validation failed", 400, meta);
  }
}
