/**
 * MODULE: moderation.application.submit-report-service
 * PURPOSE: Use case — a signed-in user submits an abuse report on a match or a
 *          player via `POST /api/reports`. Validates the target exists, blocks
 *          self-reports, and inserts with silent dedup.
 * LAYER: application
 * DEPENDENCIES (ports): ReportRepository, src/auth UserRepository (target
 *   existence), src/match_lifecycle MatchRepository (target existence)
 * CONSUMED BY: src/moderation/composition.ts → app/api/reports/route.ts
 * INVARIANTS:
 *   - **Target existence is verified before insert.** A player target that is
 *     missing / banned / soft-deleted → `ReportTargetNotFoundError` (404),
 *     mirroring the `/users/:id` privacy sentinel (outside observers can't tell
 *     which). A missing match target → 404. Cancelled matches CAN be reported
 *     (the page stays reachable).
 *   - **Self-report guard.** `type='player' && targetUserId === reporterId` →
 *     `CannotReportSelfError` (400). The UI never offers it (self → `/me`); this
 *     is the direct-API backstop.
 *   - **Silent dedup.** A repeat report on the same target by the same user is
 *     `'duplicate'` — the route still returns 200 (spec: no toast spam). The
 *     `deduped` flag is returned for tests / telemetry only.
 *   - **No notifications, no audit row.** A report is a private signal to
 *     admins; the reported user is never told (spec). The `admin_actions` audit
 *     covers role/ban actions, not report submission.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/reports" → "Submission modal"
 *   - docs/spec/pitchup-spec-global.md → "Limits" → Report comment
 */
import { asUserId } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";
import { asMatchId } from "@/src/match_lifecycle/domain/match";
import type { MatchRepository } from "@/src/match_lifecycle/domain/match-repository";

import {
  CannotReportSelfError,
  ReportTargetNotFoundError,
} from "../domain/errors";
import type { ReportType } from "../domain/report";
import type { ReportRepository } from "../domain/report-repository";

export interface SubmitReportInput {
  readonly reporterId: string;
  readonly type: ReportType;
  readonly targetId: string;
  /** Already NFC-normalised + trimmed + length-checked by the boundary Zod. */
  readonly comment: string;
}

export interface SubmitReportResult {
  /** `true` when the report already existed (no new row was written). */
  readonly deduped: boolean;
}

export class SubmitReportService {
  constructor(
    private readonly reportRepository: ReportRepository,
    private readonly userRepository: UserRepository,
    private readonly matchRepository: MatchRepository,
  ) {}

  async execute(input: SubmitReportInput): Promise<SubmitReportResult> {
    let targetMatchId: string | null = null;
    let targetUserId: string | null = null;

    if (input.type === "player") {
      if (input.targetId === input.reporterId) {
        throw new CannotReportSelfError();
      }
      const target = await this.safeFindUser(input.targetId);
      if (!target || target.banned || target.deletedAt !== null) {
        throw new ReportTargetNotFoundError();
      }
      targetUserId = input.targetId;
    } else {
      const match = await this.safeFindMatch(input.targetId);
      if (!match) {
        throw new ReportTargetNotFoundError();
      }
      targetMatchId = input.targetId;
    }

    const outcome = await this.reportRepository.insertIfAbsent({
      reporterId: input.reporterId,
      type: input.type,
      targetMatchId,
      targetUserId,
      comment: input.comment,
    });

    return { deduped: outcome === "duplicate" };
  }

  /** Non-UUID ids read as "not found" rather than throwing a cast error. */
  private async safeFindUser(id: string) {
    try {
      return await this.userRepository.findById(asUserId(id));
    } catch {
      return null;
    }
  }

  private async safeFindMatch(id: string) {
    try {
      return await this.matchRepository.findById(asMatchId(id));
    } catch {
      return null;
    }
  }
}
