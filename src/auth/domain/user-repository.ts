/**
 * MODULE: auth.domain.user-repository
 * PURPOSE: Repository port for the User aggregate. Domain owns the contract;
 *          infrastructure provides the Prisma-backed adapter.
 * LAYER: domain
 * DEPENDENCIES: ./user
 * CONSUMED BY: src/auth/application/*, src/auth/infrastructure/prisma-user-repository.ts
 * INVARIANTS:
 *   - `create` MUST be idempotent on `googleSub`: if a row already exists
 *     (parallel-tab race), return it instead of throwing. See spec
 *     "/welcome → After tapping [Get started →]" for the INSERT…ON CONFLICT
 *     DO NOTHING + SELECT fallback pattern.
 * RELATED DOCS: docs/ARCHITECTURE.md §8 (Persistence), ADR-0003.
 */
import type { GoogleSub, User, UserId } from "./user";

export interface NewUserInput {
  readonly googleSub: GoogleSub;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string;
}

/**
 * Layer 6 — fields the user can edit on `/me → Edit profile`. All optional;
 * `undefined` means "don't change". `contactInfo` can be set to `null`
 * (explicit clear) but must be a non-empty string after trim if a value is
 * supplied (callers do the trim before passing). `name` cannot be cleared —
 * it's mandatory at the schema level.
 */
export interface UpdateProfileInput {
  readonly name?: string;
  readonly contactInfo?: string | null;
  readonly emailNotifications?: boolean;
}

export interface UserRepository {
  findByGoogleSub(googleSub: GoogleSub): Promise<User | null>;
  create(input: NewUserInput): Promise<User>;
  /**
   * Bulk lookup by branded id. Layer 5 — author + lineup-player resolution
   * for the polling payload (`GET /api/matches/:id/state`) and for the
   * initial RSC page-load fetch in `/matches/:id`. Returns rows in arbitrary
   * order; callers index by id. Missing ids are simply absent from the
   * result. Banned and soft-deleted users ARE included — the render layer
   * decides whether to fall back to `[Removed user]`, not the application
   * layer (spec match.md §220; AGENTS gotcha "Author resolution at
   * render-time").
   */
  findByIds(ids: readonly UserId[]): Promise<readonly User[]>;

  /**
   * Layer 6 — partial update of the editable profile fields (name +
   * contactInfo + emailNotifications). Returns the updated row. Throws if
   * the user doesn't exist (caller already verified via `requireAuth`, so
   * not-found here is a programmer error — surfaced as a 500 by the route).
   *
   * NOT a place for advisory locks — the User aggregate has no concurrent
   * mutators (profile edits are user-initiated, single-tab). Last-write-
   * wins is acceptable.
   */
  updateProfile(userId: UserId, input: UpdateProfileInput): Promise<User>;
}
