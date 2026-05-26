/**
 * MODULE: match_lifecycle.infrastructure.prisma-join-request-repository
 * PURPOSE: Prisma adapter for `JoinRequestRepository`. All methods take the
 *          locked `tx` client — this adapter is never called outside an
 *          advisory-lock critical section in Layer 4.
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
import type { JoinRequest as JoinRequestRow } from "@prisma/client";

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
  async findByMatchAndUser(
    matchId: MatchId,
    userId: UserId,
    tx: TransactionClient,
  ): Promise<JoinRequest | null> {
    const row = await tx.joinRequest.findUnique({
      where: {
        matchId_userId: { matchId: matchId, userId: userId },
      },
    });
    return row ? toDomain(row) : null;
  }

  async findById(
    id: JoinRequestId,
    tx: TransactionClient,
  ): Promise<JoinRequest | null> {
    const row = await tx.joinRequest.findUnique({ where: { id } });
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
    tx: TransactionClient,
  ): Promise<readonly JoinRequest[]> {
    const rows = await tx.joinRequest.findMany({
      where: { matchId, status: "accepted" },
    });
    return rows.map(toDomain);
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
