/**
 * MODULE: moderation.infrastructure.prisma-report-repository
 * PURPOSE: Prisma adapter for the `ReportRepository` port.
 * LAYER: infrastructure
 * DEPENDENCIES: @prisma/client, ../domain/report, ../domain/report-repository
 * CONSUMED BY: src/moderation/infrastructure/repositories.ts
 * INVARIANTS:
 *   - `insertIfAbsent` swallows the UNIQUE-violation (P2002) into `'duplicate'`
 *     — the spec's silent dedup. Same pattern as `ReminderSentRepository`.
 *   - `markAllNewReviewed` / `markDismissed` use `updateMany` so a zero-match
 *     update is a clean count, never a P2025 throw.
 * RELATED DOCS: docs/ARCHITECTURE.md §8 (Persistence).
 */
import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  NewReportInput,
  Report,
  ReportStatus,
  ReportType,
  SubmitReportOutcome,
} from "../domain/report";
import type {
  ListReportsForAdminOptions,
  ReportRepository,
} from "../domain/report-repository";

type ReportRow = {
  id: string;
  reporterId: string;
  type: string;
  targetMatchId: string | null;
  targetUserId: string | null;
  comment: string;
  status: string;
  createdAt: Date;
  reviewedAt: Date | null;
  reviewedBy: string | null;
};

function rowToDomain(row: ReportRow): Report {
  return {
    id: row.id,
    reporterId: row.reporterId,
    type: row.type as ReportType,
    targetMatchId: row.targetMatchId,
    targetUserId: row.targetUserId,
    comment: row.comment,
    status: row.status as ReportStatus,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
  };
}

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async insertIfAbsent(input: NewReportInput): Promise<SubmitReportOutcome> {
    try {
      await this.prisma.report.create({
        data: {
          reporterId: input.reporterId,
          type: input.type,
          targetMatchId: input.targetMatchId,
          targetUserId: input.targetUserId,
          comment: input.comment,
        },
      });
      return "inserted";
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2002"
      ) {
        return "duplicate";
      }
      throw e;
    }
  }

  async listAllForAdmin(
    options: ListReportsForAdminOptions,
  ): Promise<readonly Report[]> {
    const rows = await this.prisma.report.findMany({
      where: options.type ? { type: options.type } : {},
      orderBy: { createdAt: "desc" },
      take: options.limit,
    });
    return rows.map(rowToDomain);
  }

  async findById(id: string): Promise<Report | null> {
    const row = await this.prisma.report.findUnique({ where: { id } });
    return row ? rowToDomain(row) : null;
  }

  async markAllNewReviewed(
    type: ReportType,
    targetId: string,
    reviewedBy: string,
    now: Date,
  ): Promise<number> {
    const where =
      type === "player"
        ? { type, targetUserId: targetId, status: "new" }
        : { type, targetMatchId: targetId, status: "new" };
    const result = await this.prisma.report.updateMany({
      where,
      data: { status: "reviewed", reviewedAt: now, reviewedBy },
    });
    return result.count;
  }

  async markDismissed(
    reportId: string,
    reviewedBy: string,
    now: Date,
  ): Promise<boolean> {
    const result = await this.prisma.report.updateMany({
      where: { id: reportId },
      data: { status: "dismissed", reviewedAt: now, reviewedBy },
    });
    return result.count > 0;
  }
}
