/**
 * MODULE: tests.auth.application.complete-onboarding-service
 * PURPOSE: Unit tests for CompleteOnboardingService — the /welcome use case
 *          that inserts the user row idempotently. Verifies the happy path
 *          (new user → create called) and the parallel-tab race (existing
 *          user → no create call, existing returned).
 * LAYER: tests / application
 * TESTS FOR: src/auth/application/complete-onboarding-service.ts
 * MOCKS: UserRepository port is replaced with a hand-rolled in-memory fake
 *        (FakeUserRepository) — per CODING_STANDARDS §9 "no mocks of code
 *        you own beyond ports".
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "/welcome →
 *               After tapping [Get started →]", ADR-0003.
 */
import { describe, it, expect } from "vitest";

import { CompleteOnboardingService } from "@/src/auth/application/complete-onboarding-service";
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

/**
 * In-memory UserRepository fake. Records calls and seedable findByGoogleSub
 * results. We assert against `createCalls` rather than a mock spy so test
 * intent reads as a straight list of facts.
 */
class FakeUserRepository implements UserRepository {
  public createCalls: NewUserInput[] = [];
  public findCalls: GoogleSub[] = [];
  private readonly bySub = new Map<string, User>();

  seed(user: User): void {
    this.bySub.set(user.googleSub, user);
  }

  async findByGoogleSub(googleSub: GoogleSub): Promise<User | null> {
    this.findCalls.push(googleSub);
    return this.bySub.get(googleSub) ?? null;
  }

  async create(input: NewUserInput): Promise<User> {
    this.createCalls.push(input);
    const created = makeUser({
      googleSub: input.googleSub,
      email: input.email,
      name: input.name,
      avatarUrl: input.avatarUrl,
    });
    this.bySub.set(input.googleSub, created);
    return created;
  }

  async findByIds(): Promise<readonly User[]> {
    // Unused in the onboarding service path. Tests that need it can override.
    return [];
  }

  async updateProfile(): Promise<User> {
    throw new Error("updateProfile() must not be called from onboarding flow");
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

describe("CompleteOnboardingService.execute", () => {
  it("creates a new user when findByGoogleSub returns null", async () => {
    const repo = new FakeUserRepository();
    const service = new CompleteOnboardingService(repo);

    const result = await service.execute({
      googleSub: "google_sub_new",
      email: "bob@example.com",
      name: "Bob",
      avatarUrl: "https://lh3.googleusercontent.com/a/bob",
    });

    expect(repo.createCalls).toHaveLength(1);
    expect(repo.createCalls[0]).toEqual({
      googleSub: asGoogleSub("google_sub_new"),
      email: "bob@example.com",
      name: "Bob",
      avatarUrl: "https://lh3.googleusercontent.com/a/bob",
    });
    expect(result.email).toBe("bob@example.com");
    expect(result.name).toBe("Bob");
  });

  it("returns the existing user without calling create (parallel-tab idempotency)", async () => {
    const repo = new FakeUserRepository();
    const existing = makeUser({
      id: asUserId("user_existing"),
      googleSub: asGoogleSub("google_sub_existing"),
      email: "carol@example.com",
      name: "Carol",
    });
    repo.seed(existing);
    const service = new CompleteOnboardingService(repo);

    const result = await service.execute({
      googleSub: "google_sub_existing",
      // Different input values — service must NOT overwrite the existing row.
      email: "should-not-be-used@example.com",
      name: "Should Not Be Used",
      avatarUrl: "https://example.com/should-not-be-used.png",
    });

    expect(repo.createCalls).toHaveLength(0);
    expect(result).toBe(existing);
    expect(result.email).toBe("carol@example.com");
    expect(result.name).toBe("Carol");
  });

  it("passes input fields verbatim into repo.create (googleSub/email/name/avatarUrl)", async () => {
    const repo = new FakeUserRepository();
    const service = new CompleteOnboardingService(repo);

    await service.execute({
      googleSub: "sub_verbatim",
      email: "verbatim@example.com",
      name: "Verbatim Name",
      avatarUrl: "https://example.com/verbatim.png",
    });

    expect(repo.createCalls).toHaveLength(1);
    const call = repo.createCalls[0]!;
    expect(call.googleSub).toBe(asGoogleSub("sub_verbatim"));
    expect(call.email).toBe("verbatim@example.com");
    expect(call.name).toBe("Verbatim Name");
    expect(call.avatarUrl).toBe("https://example.com/verbatim.png");
  });
});
