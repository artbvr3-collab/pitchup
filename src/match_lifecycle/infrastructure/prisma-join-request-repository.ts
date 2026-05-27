/**
 * MODULE: match_lifecycle.infrastructure.prisma-join-request-repository
 * PURPOSE: Prisma adapter for `JoinRequestRepository`.
 *          - Write methods + the reads they call (under lock) take a `tx`
 *            client from `withMatchLock` (Layer 4 — join / approve / reject).
 *          - Read methods are also callable without `tx`. The adapter falls
 *            back to the module-singleton `prisma` injected via the
 *            constructor. Layer 5 (chat role gating + polling lineup
 *            snapshot) needs unlocked snapshots; mirroring the same
 *            `tx ?? prisma` shape `PrismaMatchRepository.findById` uses.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/*
 * CONSUMED BY: src/match_lifecycle/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `upsertToPending` is a SELECT-then-(INSERT|UPDATE|return) sequence.
 *     Safe because the surrounding tx already holds the advisory lock on
 *     `match:{matchId}` (spec match.md → "Advisory lock strategy") — no
 *     other writer can race within the same match.
 *   - Domain `JoinRequest` is reconstructed via `toDomain` mapping; Prisma
 *     row shape stays inside this file.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist", "Player
 *     match states" (UPSERT update rules)
 *   - ADR-0003
 */
import type { JoinRequest as JoinRequestRow, PrismaClient } from "@prisma/client";

import { asUserId, type UserId } from "@/src/auth/domain/user";
import type { TransactionClient } from "@/src/shared/db/types";

import {
  asJoinRequestId,
  type JoinRequest,
  type JoinRequestAutoReason,
  type JoinRequestId,
  type JoinRequestStatus,
} from "../domain/join-request";
import type {
  JoinRequestRepository,
  UpsertToPendingInput,
  UpsertToPendingResult,
} from "../domain/join-request-repository";
import { asMatchId, type MatchId } from "../domain/match";

export class PrismaJoinRequestRepository implements JoinRequestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByMatchAndUser(
    matchId: MatchId,
    userId: UserId,
    tx?: TransactionClient,
  ): Promise<JoinRequest | null> {
    const client = tx ?? this.prisma;
    const row = await client.joinRequest.findUnique({
      where: {
        matchId_userId: { matchId: matchId, userId: userId },
      },
    });
    return row ? toDomain(row) : null;
  }

  async findById(
    id: JoinRequestId,
    tx?: TransactionClient,
  ): Promise<JoinRequest | null> {
    const client = tx ?? this.prisma;
    const row = await client.joinRequest.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async upsertToPending(
    input: UpsertToPendingInput,
    tx: TransactionClient,
  ): Promise<UpsertToPendingResult> {
    const existing = await tx.joinRequest.findUnique({
      where: {
        matchId_userId: { matchId: input.matchId, userId: input.userId },
      },
    });

    if (!existing) {
      const created = await tx.joinRequest.create({
        data: {
          matchId: input.matchId,
          userId: input.userId,
          status: "pending",
          guestCount: input.guestCount,
          message: input.message,
          autoReason: null,
        },
      });
      return { outcome: "inserted", row: toDomain(created) };
    }

    if (existing.status === "pending" || existing.status === "accepted") {
      return {
        outcome: "conflict",
        existingStatus: existing.status,
        row: toDomain(existing),
      };
    }

    // rejected / cancelled / left / kicked → revive
    const updated = await tx.joinRequest.update({
      where: { id: existing.id },
      data: {
        status: "pending",
        guestCount: input.guestCount,
        message: input.message,
        autoReason: null,
      },
    });
    return { outcome: "revived", row: toDomain(updated) };
  }

  async updateStatus(
    id: JoinRequestId,
    status: JoinRequestStatus,
    autoReason: "match_started" | "match_cancelled" | null,
    tx: TransactionClient,
  ): Promise<void> {
    await tx.joinRequest.update({
      where: { id },
      data: { status, autoReason },
    });
  }

  async listAcceptedForMatch(
    matchId: MatchId,
    tx?: TransactionClient,
  ): Promise<readonly JoinRequest[]> {
    const client = tx ?? this.prisma;
    const rows = await client.joinRequest.findMany({
      where: { matchId, status: "accepted" },
      orderBy: { updatedAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async listPendingForMatch(
    matchId: MatchId,
    tx?: TransactionClient,
  ): Promise<readonly JoinRequest[]> {
    const client = tx ?? this.prisma;
    const rows = await client.joinRequest.findMany({
      where: { matchId, status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toDomain);
  }

  async listForUser(userId: UserId): Promise<readonly JoinRequest[]> {
    const rows = await this.prisma.joinRequest.findMany({
      where: { userId },
    });
    return rows.map(toDomain);
  }

  async massRejectPending(
    matchId: MatchId,
    autoReason: "match_started" | "match_cancelled",
    tx: TransactionClient,
  ): Promise<readonly JoinRequest[]> {
    // Snapshot the pending rows first so the caller (CancelMatchService /
    // future cron) can fan-out Layer 7 notifications addressed to each
    // formerly-pending user. We don't rely on `updateMany().count` because
    // the user-id list is needed downstream.
    const pending = await tx.joinRequest.findMany({
      where: { matchId, status: "pending" },
    });
    if (pending.length === 0) return [];

    await tx.joinRequest.updateMany({
      where: { matchId, status: "pending" },
      data: { status: "rejected", autoReason },
    });

    // Return the pre-image rows with the new status materialised — caller
    // only needs ids + userIds, but the full row keeps the helper composable.
    return pending.map((row) =>
      toDomain({ ...row, status: "rejected", autoReason }),
    );
  }
}

function toDomain(row: JoinRequestRow): JoinRequest {
  return {
    id: asJoinRequestId(row.id),
    matchId: asMatchId(row.matchId),
    userId: asUserId(row.userId),
    status: row.status as JoinRequestStatus,
    guestCount: row.guestCount,
    message: row.message,
    autoReason: (row.autoReason as JoinRequestAutoReason) ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
