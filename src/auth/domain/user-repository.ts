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
   * Layer 7.5 — single lookup that DOES include soft-deleted / banned rows.
   * Used by `/users/:id` to render the unified "This user is no longer on
   * PITCHUP." state without leaking ban-vs-delete to outside observers
   * (spec global.md "Ban / account deletion" — privacy). The route handler
   * checks `user.banned || user.deletedAt !== null` itself and renders the
   * sentinel; the repository does not filter.
   *
   * Returns `null` only if the row truly doesn't exist (404 branch).
   */
  findById(id: UserId): Promise<User | null>;

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

  /**
   * Layer 7.5 — count of users that currently hold admin rights.
   *
   * Predicate: `is_admin = true AND banned = false AND deleted_at IS NULL`.
   * The spec personal.md last-admin guard reads `count(is_admin=true,
   * banned=false) === 1`; we also exclude `deleted_at IS NULL` because a
   * soft-deleted admin cannot act (their sessions are invalidated by
   * `requireAuth` and they cannot re-sign-in). Including them in the count
   * would let the last live admin block themselves from self-delete forever.
   *
   * `excludeUserId` is the "would there still be one left if I removed
   * myself?" probe — DeleteAccountService passes the caller's id so the
   * count answers "OTHER active admins". For Layer 9 admin demote/ban from
   * a different actor, callers pass the target's id.
   */
  countActiveAdmins(excludeUserId?: UserId): Promise<number>;

  /**
   * Layer 7.5 — mark the account as soft-deleted (`deleted_at = now()`).
   * Idempotent: a second call on an already-deleted row is a no-op (re-set
   * to the same value is harmless; the column-based session invalidation
   * already kicked in on the first write). Called LAST in
   * `DeleteAccountService.execute` so a partial-cascade failure leaves the
   * account undeleted and the user can retry.
   *
   * No advisory lock — the User aggregate has no concurrent mutators per
   * the Layer 6 convention. The cascade-cancel of upcoming captain matches
   * runs under per-match advisory locks BEFORE this call, in its own tx
   * per match.
   */
  markDeleted(userId: UserId): Promise<void>;
}
