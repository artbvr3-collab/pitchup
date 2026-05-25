/**
 * MODULE: auth.domain.user
 * PURPOSE: User entity + branded id/google-sub types. Pure data + invariants —
 *          no I/O, no Prisma imports. Materialised by infrastructure adapters,
 *          consumed by application use cases.
 * LAYER: domain
 * DEPENDENCIES: none (stdlib types only)
 * CONSUMED BY: src/auth/domain/user-repository.ts,
 *              src/auth/application/*, src/auth/infrastructure/*
 * INVARIANTS:
 *   - Row exists ⇔ onboarding was completed (spec: "User row is created only
 *     on onboarding completion").
 *   - `deletedAt === null` for an active account; non-null means soft-deleted.
 *   - `banned === true` invalidates the session (spec: "Session invalidation").
 *   - `name` / `email` / `avatarUrl` are a snapshot taken at onboarding —
 *     they are NOT synced with Google afterwards.
 * RELATED DOCS: docs/spec/pitchup-app-map.md "User",
 *               docs/spec/pitchup-spec-global.md "Authentication".
 */

declare const userIdBrand: unique symbol;
export type UserId = string & { readonly [userIdBrand]: void };

declare const googleSubBrand: unique symbol;
export type GoogleSub = string & { readonly [googleSubBrand]: void };

export interface User {
  readonly id: UserId;
  readonly googleSub: GoogleSub;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string;
  readonly contactInfo: string | null;
  readonly emailNotifications: boolean;
  readonly isAdmin: boolean;
  readonly banned: boolean;
  readonly deletedAt: Date | null;
  readonly createdAt: Date;
}

// Use these at the infrastructure boundary (mapping Prisma rows / OAuth
// profile claims into domain types). Application code receives already-branded
// values from the repository.
export const asUserId = (value: string): UserId => value as UserId;
export const asGoogleSub = (value: string): GoogleSub => value as GoogleSub;
