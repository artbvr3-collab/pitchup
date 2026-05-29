/**
 * MODULE: notifications.infrastructure.prisma-notification-repository
 * PURPOSE: Prisma adapter for `NotificationRepository`.
 *          - Write methods (insert / insertMany) take a mandatory `tx` client —
 *            they are only ever called inside an advisory-locked transaction.
 *          - Read / standalone methods (listRecent / hasUnread / markAllRead /
 *            deleteOlderThan) run against the singleton Prisma client injected
 *            via the constructor; no surrounding transaction is needed.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/notifications/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `insert` / `insertMany` must only be called inside `withMatchLock`.
 *   - `toDomain` is a pure local mapping — Prisma row shape stays inside this
 *     file.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Notifications"
 *   - ADR-0003
 */
import type { Notification as NotificationRow, PrismaClient } from "@prisma/client";

import type { TransactionClient } from "@/src/shared/db/types";

import type { NewNotification, NotificationType } from "../domain/notification";
import type { NotificationRow as DomainNotificationRow } from "../domain/notification";
import type { NotificationRepository } from "../domain/notification-repository";

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insert(n: NewNotification, tx: TransactionClient): Promise<void> {
    await tx.notification.create({
      data: {
        userId: n.userId,
        type: n.type,
        matchId: n.matchId,
        body: n.body,
      },
    });
  }

  async insertMany(
    ns: readonly NewNotification[],
    tx: TransactionClient,
  ): Promise<void> {
    if (ns.length === 0) return;
    await tx.notification.createMany({
      data: ns.map((n) => ({
        userId: n.userId,
        type: n.type,
        matchId: n.matchId,
        body: n.body,
      })),
    });
  }

  async listRecent(
    userId: string,
    limit = 20,
  ): Promise<readonly DomainNotificationRow[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async hasUnread(userId: string): Promise<boolean> {
    const row = await this.prisma.notification.findFirst({
      where: { userId, readAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const res = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return res.count;
  }
}

function toDomain(row: NotificationRow): DomainNotificationRow {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as NotificationType,
    matchId: row.matchId,
    body: row.body,
    createdAt: row.createdAt,
    readAt: row.readAt,
  };
}
