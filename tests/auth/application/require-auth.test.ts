/**
 * MODULE: tests.auth.application.require-auth
 * PURPOSE: Unit tests for requireAuthCore — the canonical auth gate. Covers
 *          all four UnauthorizedError discriminants (no_session,
 *          user_not_found, banned, deleted) plus the happy path that
 *          returns AuthenticatedUser.
 * LAYER: tests / application
 * TESTS FOR: src/auth/application/require-auth.ts
 * MOCKS: UserRepository port is replaced with a hand-rolled in-memory fake
 *        (FakeUserRepository). The session-getter is a plain arrow function
 *        per test — no library mock framework needed.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "Authentication" →
 *               "Session invalidation".
 */
import { describe, it, expect } from "vitest";

import { requireAuthCore } from "@/src/auth/application/require-auth";
import {
  asGoogleSub,
  asUserId,
  type GoogleSub,
  type User,
} from "@/src/auth/domain/user";
import type {
  NewUserInput,
  UserRepository,
} from "@/src/auth/domain/user-repository";
import { UnauthorizedError } from "@/src/shared/errors/app-error";

class FakeUserRepository implements UserRepository {
  private readonly bySub = new Map<string, User>();

  seed(user: User): void {
    this.bySub.set(user.googleSub, user);
  }

  async findByGoogleSub(googleSub: GoogleSub): Promise<User | null> {
    return this.bySub.get(googleSub) ?? null;
  }

  async create(_input: NewUserInput): Promise<User> {
    throw new Error("create() must not be called from requireAuthCore");
  }
}

function makeUser(overrides: Partial<User> = {}): User {
  const defaults: User = {
    id: asUserId("user_1"),
    googleSub: asGoogleSub("google_sub_1"),
    email: "alice@example.com",
    name: "Alice",
    avatarUrl: "https://lh3.googleusercontent.com/a/alice",
    contactInfo: null,
    emailNotifications: true,
    isAdmin: false,
    banned: false,
    deletedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
  return { ...defaults, ...overrides };
}

/**
 * Awaits a promise and returns the thrown UnauthorizedError. Fails the test
 * if the promise resolves or throws something else — gives us a typed handle
 * for `.code` assertions without dancing around try/catch in every case.
 */
async function expectUnauthorized(
  promise: Promise<unknown>,
): Promise<UnauthorizedError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(UnauthorizedError);
    return err as UnauthorizedError;
  }
  throw new Error("Expected UnauthorizedError to be thrown, but promise resolved");
}

describe("requireAuthCore", () => {
  it('throws UnauthorizedError("no_session") when getSession resolves to null', async () => {
    const repo = new FakeUserRepository();
    const err = await expectUnauthorized(
      requireAuthCore(async () => null, repo),
    );
    expect(err.code).toBe("no_session");
  });

  it('throws UnauthorizedError("no_session") when session has no googleSub', async () => {
    const repo = new FakeUserRepository();
    const err = await expectUnauthorized(
      requireAuthCore(async () => ({}), repo),
    );
    expect(err.code).toBe("no_session");
  });

  it('throws UnauthorizedError("user_not_found") when repo returns null', async () => {
    const repo = new FakeUserRepository();
    const err = await expectUnauthorized(
      requireAuthCore(async () => ({ googleSub: "unknown_sub" }), repo),
    );
    expect(err.code).toBe("user_not_found");
  });

  it('throws UnauthorizedError("banned") when user.banned is true', async () => {
    const repo = new FakeUserRepository();
    repo.seed(
      makeUser({
        googleSub: asGoogleSub("banned_sub"),
        banned: true,
      }),
    );
    const err = await expectUnauthorized(
      requireAuthCore(async () => ({ googleSub: "banned_sub" }), repo),
    );
    expect(err.code).toBe("banned");
  });

  it('throws UnauthorizedError("deleted") when user.deletedAt is not null', async () => {
    const repo = new FakeUserRepository();
    repo.seed(
      makeUser({
        googleSub: asGoogleSub("deleted_sub"),
        deletedAt: new Date("2026-02-01T00:00:00.000Z"),
      }),
    );
    const err = await expectUnauthorized(
      requireAuthCore(async () => ({ googleSub: "deleted_sub" }), repo),
    );
    expect(err.code).toBe("deleted");
  });

  it("returns AuthenticatedUser on the happy path with all expected fields", async () => {
    const repo = new FakeUserRepository();
    repo.seed(
      makeUser({
        id: asUserId("user_happy"),
        googleSub: asGoogleSub("happy_sub"),
        email: "happy@example.com",
        name: "Happy User",
        isAdmin: true,
      }),
    );

    const result = await requireAuthCore(
      async () => ({ googleSub: "happy_sub" }),
      repo,
    );

    expect(result).toEqual({
      userId: asUserId("user_happy"),
      googleSub: asGoogleSub("happy_sub"),
      email: "happy@example.com",
      name: "Happy User",
      isAdmin: true,
    });
  });
});
