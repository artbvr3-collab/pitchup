/**
 * MODULE: tests.auth.application.update-profile-service
 * PURPOSE: Cover the field validation + NFC normalization + persistence
 *          path of `UpdateProfileService` (`/me → Edit profile` Server
 *          Action).
 * LAYER: tests / application
 * TESTS FOR: src/auth/application/update-profile-service.ts
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/me → Section ACCOUNT"
 *   - docs/spec/pitchup-spec-global.md → "Text field validation &
 *     sanitization" (length caps)
 */
import { describe, expect, it } from "vitest";

import {
  ContactInfoTooLongError,
  InvalidNameError,
  UpdateProfileService,
} from "@/src/auth/application/update-profile-service";
import {
  asGoogleSub,
  asUserId,
  type User,
} from "@/src/auth/domain/user";
import type {
  UpdateProfileInput,
  UserRepository,
} from "@/src/auth/domain/user-repository";

class FakeUserRepo implements UserRepository {
  public updates: Array<{ userId: string; input: UpdateProfileInput }> = [];

  async findByGoogleSub(): Promise<User | null> {
    throw new Error("not used");
  }
  async create(): Promise<User> {
    throw new Error("not used");
  }
  async findByIds(): Promise<readonly User[]> {
    return [];
  }
  async findById(): Promise<User | null> {
    return null;
  }
  async countActiveAdmins(): Promise<number> {
    throw new Error("not used in update-profile tests");
  }
  async markDeleted(): Promise<void> {
    throw new Error("not used in update-profile tests");
  }
  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<User> {
    this.updates.push({ userId, input });
    return {
      ...USER,
      name: input.name ?? USER.name,
      contactInfo:
        input.contactInfo === undefined ? USER.contactInfo : input.contactInfo,
      emailNotifications:
        input.emailNotifications ?? USER.emailNotifications,
    };
  }
}

const USER_ID = asUserId("user-1");

const USER: User = {
  id: USER_ID,
  googleSub: asGoogleSub("google-sub-1"),
  email: "alice@example.com",
  name: "Alice",
  avatarUrl: "https://example/a",
  contactInfo: null,
  emailNotifications: true,
  isAdmin: false,
  banned: false,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("UpdateProfileService", () => {
  it("updates name with trim + NFC normalize", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await svc.execute({ userId: USER_ID, name: "  Bobby  " });
    expect(repo.updates[0]!.input).toEqual({ name: "Bobby" });
  });

  it("rejects empty name (after trim)", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await expect(
      svc.execute({ userId: USER_ID, name: "   " }),
    ).rejects.toBeInstanceOf(InvalidNameError);
    expect(repo.updates).toEqual([]);
  });

  it("rejects name > 100 chars", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await expect(
      svc.execute({ userId: USER_ID, name: "A".repeat(101) }),
    ).rejects.toBeInstanceOf(InvalidNameError);
  });

  it("contactInfo: empty string after trim → stored as null", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await svc.execute({ userId: USER_ID, contactInfo: "   " });
    expect(repo.updates[0]!.input).toEqual({ contactInfo: null });
  });

  it("contactInfo: explicit null clears the field", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await svc.execute({ userId: USER_ID, contactInfo: null });
    expect(repo.updates[0]!.input).toEqual({ contactInfo: null });
  });

  it("contactInfo: non-empty string → trimmed + NFC stored", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await svc.execute({
      userId: USER_ID,
      contactInfo: "  WhatsApp: +420 123 456 789  ",
    });
    expect(repo.updates[0]!.input).toEqual({
      contactInfo: "WhatsApp: +420 123 456 789",
    });
  });

  it("rejects contactInfo > 200 chars (after trim)", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await expect(
      svc.execute({ userId: USER_ID, contactInfo: "x".repeat(201) }),
    ).rejects.toBeInstanceOf(ContactInfoTooLongError);
  });

  it("emailNotifications passes straight through", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await svc.execute({ userId: USER_ID, emailNotifications: false });
    expect(repo.updates[0]!.input).toEqual({ emailNotifications: false });
  });

  it("partial patches — only sets the fields that were provided", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await svc.execute({ userId: USER_ID, emailNotifications: true });
    expect(repo.updates[0]!.input).toEqual({ emailNotifications: true });
    expect(Object.keys(repo.updates[0]!.input)).toEqual(["emailNotifications"]);
  });

  it("combined patch — name + contactInfo + emailNotifications all sent", async () => {
    const repo = new FakeUserRepo();
    const svc = new UpdateProfileService(repo);
    await svc.execute({
      userId: USER_ID,
      name: "Carol",
      contactInfo: "tg @carol",
      emailNotifications: false,
    });
    expect(repo.updates[0]!.input).toEqual({
      name: "Carol",
      contactInfo: "tg @carol",
      emailNotifications: false,
    });
  });
});
