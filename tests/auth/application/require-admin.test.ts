/**
 * MODULE: tests.auth.application.require-admin
 * PURPOSE: Cover the admin API gate `requireAdminCore` — admin passes,
 *          non-admin → 403 forbidden (admin_required), and the requireAuth
 *          layer still short-circuits invalid sessions before the admin check.
 * LAYER: tests / application
 * TESTS FOR: src/auth/application/require-admin.ts
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin" → Access.
 */
import { describe, expect, it } from "vitest";

import { requireAdminCore } from "@/src/auth/application/require-admin";
import { asGoogleSub, asUserId, type User } from "@/src/auth/domain/user";
import type { GoogleSub } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";
import { ForbiddenError, UnauthorizedError } from "@/src/shared/errors/app-error";

const BASE: User = {
  id: asUserId("11111111-1111-1111-1111-111111111111"),
  googleSub: asGoogleSub("sub-1"),
  email: "u@example.com",
  name: "U",
  avatarUrl: "https://example.com/a.png",
  contactInfo: null,
  emailNotifications: true,
  isAdmin: false,
  banned: false,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

/** Minimal UserRepository — only findByGoogleSub is exercised by the gate. */
function repoReturning(user: User | null): UserRepository {
  return {
    findByGoogleSub: async (_sub: GoogleSub) => user,
  } as unknown as UserRepository;
}

const session = async () => ({ googleSub: "sub-1" });

describe("requireAdminCore", () => {
  it("admin → returns the authenticated user", async () => {
    const result = await requireAdminCore(
      session,
      repoReturning({ ...BASE, isAdmin: true }),
    );
    expect(result.isAdmin).toBe(true);
    expect(result.userId).toBe(BASE.id);
  });

  it("non-admin → ForbiddenError(admin_required)", async () => {
    await expect(
      requireAdminCore(session, repoReturning({ ...BASE, isAdmin: false })),
    ).rejects.toMatchObject({ code: "admin_required" });
    await expect(
      requireAdminCore(session, repoReturning({ ...BASE, isAdmin: false })),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("no session → UnauthorizedError (before the admin check)", async () => {
    await expect(
      requireAdminCore(async () => null, repoReturning({ ...BASE, isAdmin: true })),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("banned admin → UnauthorizedError (requireAuth short-circuits)", async () => {
    await expect(
      requireAdminCore(
        session,
        repoReturning({ ...BASE, isAdmin: true, banned: true }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
