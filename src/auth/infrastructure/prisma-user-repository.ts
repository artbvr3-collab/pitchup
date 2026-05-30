/**
 * MODULE: auth.infrastructure.prisma-user-repository
 * PURPOSE: Prisma adapter for the `UserRepository` port. Translates between
 *          Prisma row types (snake_case columns via @map) and domain types.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/user, ../domain/user-repository
 * CONSUMED BY: src/auth/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `create` swallows Prisma P2002 (unique constraint violation on
 *     `google_sub`) and returns the existing row — the spec's idempotency
 *     guarantee for the parallel-tab race in `/welcome`.
 * RELATED DOCS: docs/ARCHITECTURE.md §8 (Persistence).
 */
import type { PrismaClient, User as PrismaUser } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  asGoogleSub,
  asUserId,
  type GoogleSub,
  type User,
  type UserId,
} from "../domain/user";
import type {
  AdminUserListFilters,
  NewUserInput,
  UserRepository,
} from "../domain/user-repository";

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByGoogleSub(googleSub: GoogleSub): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { googleSub } });
    return row ? mapToDomain(row) : null;
  }

  async create(input: NewUserInput): Promise<User> {
    try {
      const row = await this.prisma.user.create({
        data: {
          googleSub: input.googleSub,
          email: input.email,
          name: input.name,
          avatarUrl: input.avatarUrl,
        },
      });
      return mapToDomain(row);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        const existing = await this.prisma.user.findUnique({
          where: { googleSub: input.googleSub },
        });
        if (existing) return mapToDomain(existing);
      }
      throw err;
    }
  }

  async findByIds(ids: readonly UserId[]): Promise<readonly User[]> {
    if (ids.length === 0) return [];
    // UserId is a string-brand; Prisma's `in` accepts string[]. Cast via
    // `unknown` to drop the brand on the wire — same shape, different type.
    const rows = await this.prisma.user.findMany({
      where: { id: { in: ids as unknown as string[] } },
    });
    return rows.map(mapToDomain);
  }

  async findById(id: UserId): Promise<User | null> {
    // Layer 7.5 — DOES NOT filter by banned / deletedAt; the public
    // `/users/:id` route handles the unified "no longer on PITCHUP" render
    // path. Returns null only on a true 404 (row absent).
    const row = await this.prisma.user.findUnique({
      where: { id: id as unknown as string },
    });
    return row ? mapToDomain(row) : null;
  }

  async countActiveAdmins(excludeUserId?: UserId): Promise<number> {
    return this.prisma.user.count({
      where: {
        isAdmin: true,
        banned: false,
        deletedAt: null,
        ...(excludeUserId !== undefined
          ? { id: { not: excludeUserId as unknown as string } }
          : {}),
      },
    });
  }

  async markDeleted(userId: UserId): Promise<void> {
    // Idempotent: setting deletedAt twice is harmless (column-based session
    // invalidation already triggered on the first write). No advisory lock —
    // User aggregate has no concurrent mutators.
    await this.prisma.user.update({
      where: { id: userId as unknown as string },
      data: { deletedAt: new Date() },
    });
  }

  async setBanned(userId: UserId, banned: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId as unknown as string },
      data: { banned },
    });
  }

  async setAdmin(userId: UserId, isAdmin: boolean): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId as unknown as string },
      data: { isAdmin },
    });
  }

  async listForAdmin(filters: AdminUserListFilters): Promise<readonly User[]> {
    const where: Prisma.UserWhereInput = { deletedAt: null };
    if (filters.adminFilter === "yes") where.isAdmin = true;
    if (filters.adminFilter === "no") where.isAdmin = false;
    if (filters.statusFilter === "active") where.banned = false;
    if (filters.statusFilter === "banned") where.banned = true;
    if (filters.search !== undefined && filters.search.length > 0) {
      where.OR = [
        { name: { contains: filters.search, mode: "insensitive" } },
        { email: { contains: filters.search, mode: "insensitive" } },
      ];
    }
    const rows = await this.prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: filters.limit,
    });
    return rows.map(mapToDomain);
  }

  async updateProfile(
    userId: UserId,
    input: {
      name?: string;
      contactInfo?: string | null;
      emailNotifications?: boolean;
    },
  ): Promise<User> {
    const data: {
      name?: string;
      contactInfo?: string | null;
      emailNotifications?: boolean;
    } = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.contactInfo !== undefined) data.contactInfo = input.contactInfo;
    if (input.emailNotifications !== undefined) {
      data.emailNotifications = input.emailNotifications;
    }
    const row = await this.prisma.user.update({
      where: { id: userId },
      data,
    });
    return mapToDomain(row);
  }
}

function mapToDomain(row: PrismaUser): User {
  return {
    id: asUserId(row.id),
    googleSub: asGoogleSub(row.googleSub),
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    contactInfo: row.contactInfo,
    emailNotifications: row.emailNotifications,
    isAdmin: row.isAdmin,
    banned: row.banned,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
  };
}
