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
}
