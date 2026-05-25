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
import { asGoogleSub, asUserId, type GoogleSub, type User } from "../domain/user";
import type { NewUserInput, UserRepository } from "../domain/user-repository";

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
