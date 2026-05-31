/**
 * MODULE: moderation.application.list-admin-reports-service
 * PURPOSE: Assembles the `/admin/reports` list. Reads recent reports (≤LIMIT,
 *          newest-first, optional type filter), groups them by target, derives
 *          the aggregated status ladder per group, batch-resolves reporter +
 *          target details, applies the aggregated-status filter, and sorts
 *          (New → Reviewed → Dismissed, then latest-report DESC).
 * LAYER: application (cross-context read assembler)
 * DEPENDENCIES (ports): ReportRepository, src/auth UserRepository,
 *   src/match_lifecycle MatchRepository (+ deriveMatchStatus / computeSlots)
 * CONSUMED BY: src/moderation/composition.ts → app/admin/reports/page.tsx
 * INVARIANTS:
 *   - **Grouped by target** (spec personal.md §316): one row per `(type,
 *     targetId)`, even for N reports from N users. Orphaned match reports
 *     (target admin-deleted → `targetMatchId` null) each form their OWN group
 *     so they don't collapse together; shown as "[Deleted match]".
 *   - **Aggregated status ladder** (spec §317): any `new` → New; else any
 *     `reviewed` → Reviewed; else Dismissed.
 *   - **Sort** (spec §324): group New first, then Reviewed, then Dismissed;
 *     within a group by latest-report DESC.
 *   - **No N+1**: reporters + player targets resolved in ONE `findByIds`, match
 *     targets in ONE `findForAdminByIds`. Status derived on-read (no DB column),
 *     same `deriveMatchStatus`/`computeSlots` pairing as ListAdminMatches.
 *   - Pure read — no advisory lock, no writes.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/reports" → "List".
 */
import { asUserId, type User } from "@/src/auth/domain/user";
import type { UserRepository } from "@/src/auth/domain/user-repository";
import type { AdminMatchRow, MatchRepository } from "@/src/match_lifecycle/domain/match-repository";
import { deriveMatchStatus } from "@/src/match_lifecycle/domain/match-status";
import { computeSlots } from "@/src/match_lifecycle/domain/slot-math";

import type { Report, ReportStatus, ReportType } from "../domain/report";
import type { ReportRepository } from "../domain/report-repository";

export type AdminMatchStatus =
  | "open"
  | "almostFull"
  | "full"
  | "inProgress"
  | "ended"
  | "cancelled";

const LIVE_STATUSES = new Set<AdminMatchStatus>(["open", "almostFull", "full"]);

export interface AdminReportEntry {
  readonly id: string;
  readonly reporterName: string;
  readonly comment: string;
  readonly createdAt: Date;
  readonly status: ReportStatus;
}

export interface AdminReportPlayerTarget {
  readonly kind: "player";
  readonly userId: string;
  readonly name: string;
  /** Banned / soft-deleted / vanished — surfaces a muted style in the table. */
  readonly removed: boolean;
}

export interface AdminReportMatchTarget {
  readonly kind: "match";
  /** `null` ⇒ the match was admin hard-deleted (orphaned report). */
  readonly matchId: string | null;
  readonly venueName: string;
  readonly startTime: Date | null;
  readonly status: AdminMatchStatus | null;
  /** Cancel is offered only for live matches (Open / AlmostFull / Full). */
  readonly isLive: boolean;
  readonly hasDescription: boolean;
  readonly descriptionHidden: boolean;
  readonly hasCancelReason: boolean;
  readonly cancelReasonHidden: boolean;
  readonly isCancelled: boolean;
}

export interface AdminReportGroup {
  readonly type: ReportType;
  readonly targetId: string | null;
  readonly reportCount: number;
  readonly lastReportAt: Date;
  readonly aggregatedStatus: ReportStatus;
  readonly target: AdminReportPlayerTarget | AdminReportMatchTarget;
  /** Newest-first; the modal shows reports[0] by default + "View all N". */
  readonly reports: readonly AdminReportEntry[];
}

export interface ListAdminReportsInput {
  readonly typeFilter: ReportType | null;
  readonly statusFilter: ReportStatus | null;
}

export interface ListAdminReportsResult {
  readonly groups: readonly AdminReportGroup[];
  /** `true` when the raw scan hit LIMIT (older reports may be unshown). */
  readonly truncated: boolean;
}

const STATUS_RANK: Record<ReportStatus, number> = {
  new: 0,
  reviewed: 1,
  dismissed: 2,
};

interface GroupAccumulator {
  type: ReportType;
  targetId: string | null;
  reports: Report[];
}

export class ListAdminReportsService {
  static readonly LIMIT = 500;

  constructor(
    private readonly reportRepository: ReportRepository,
    private readonly userRepository: UserRepository,
    private readonly matchRepository: MatchRepository,
  ) {}

  async execute(
    input: ListAdminReportsInput,
    now: Date,
  ): Promise<ListAdminReportsResult> {
    const rows = await this.reportRepository.listAllForAdmin({
      ...(input.typeFilter ? { type: input.typeFilter } : {}),
      limit: ListAdminReportsService.LIMIT,
    });
    const truncated = rows.length >= ListAdminReportsService.LIMIT;

    // --- Group by target (orphaned match reports group individually) ---------
    const accumulators = new Map<string, GroupAccumulator>();
    for (const r of rows) {
      const targetId =
        r.type === "player" ? r.targetUserId : r.targetMatchId;
      const key =
        targetId === null
          ? `${r.type}:orphan:${r.id}`
          : `${r.type}:${targetId}`;
      let acc = accumulators.get(key);
      if (!acc) {
        acc = { type: r.type, targetId, reports: [] };
        accumulators.set(key, acc);
      }
      acc.reports.push(r); // rows are newest-first; preserved per group
    }

    // --- Batch-resolve reporter + target details ----------------------------
    const userIds = new Set<string>();
    const matchIds = new Set<string>();
    for (const acc of accumulators.values()) {
      for (const r of acc.reports) userIds.add(r.reporterId);
      if (acc.type === "player" && acc.targetId) userIds.add(acc.targetId);
      if (acc.type === "match" && acc.targetId) matchIds.add(acc.targetId);
    }

    const [users, matches] = await Promise.all([
      this.userRepository.findByIds(
        [...userIds].map((id) => asUserId(id)),
      ),
      this.matchRepository.findForAdminByIds([...matchIds]),
    ]);
    const userById = new Map(users.map((u) => [u.id as string, u]));
    const matchById = new Map(matches.map((m) => [m.id, m]));

    // --- Build groups -------------------------------------------------------
    const groups: AdminReportGroup[] = [];
    for (const acc of accumulators.values()) {
      const aggregatedStatus = aggregate(acc.reports);
      if (input.statusFilter && aggregatedStatus !== input.statusFilter) {
        continue;
      }

      const entries: AdminReportEntry[] = acc.reports.map((r) => ({
        id: r.id,
        reporterName: userById.get(r.reporterId)?.name ?? "[Unknown user]",
        comment: r.comment,
        createdAt: r.createdAt,
        status: r.status,
      }));

      const target =
        acc.type === "player"
          ? this.buildPlayerTarget(acc.targetId, userById)
          : this.buildMatchTarget(acc.targetId, matchById, now);

      groups.push({
        type: acc.type,
        targetId: acc.targetId,
        reportCount: acc.reports.length,
        lastReportAt: acc.reports[0]!.createdAt,
        aggregatedStatus,
        target,
        reports: entries,
      });
    }

    // --- Sort: New > Reviewed > Dismissed, then latest-report DESC -----------
    groups.sort((a, b) => {
      const byStatus =
        STATUS_RANK[a.aggregatedStatus] - STATUS_RANK[b.aggregatedStatus];
      if (byStatus !== 0) return byStatus;
      return b.lastReportAt.getTime() - a.lastReportAt.getTime();
    });

    return { groups, truncated };
  }

  private buildPlayerTarget(
    targetId: string | null,
    userById: Map<string, User>,
  ): AdminReportPlayerTarget {
    // A player report always has a non-null target (users are never hard-
    // deleted), but stay defensive for the impossible orphan.
    if (targetId === null) {
      return { kind: "player", userId: "", name: "[Unknown user]", removed: true };
    }
    const user = userById.get(targetId);
    if (!user) {
      return { kind: "player", userId: targetId, name: "[Unknown user]", removed: true };
    }
    return {
      kind: "player",
      userId: targetId,
      name: user.name,
      removed: user.banned || user.deletedAt !== null,
    };
  }

  private buildMatchTarget(
    targetId: string | null,
    matchById: Map<string, AdminMatchRow>,
    now: Date,
  ): AdminReportMatchTarget {
    const row = targetId === null ? undefined : matchById.get(targetId);
    if (!row) {
      // Orphan — the match was admin hard-deleted (Layer 9c). Only Dismiss
      // remains in the Review modal.
      return {
        kind: "match",
        matchId: null,
        venueName: "[Deleted match]",
        startTime: null,
        status: null,
        isLive: false,
        hasDescription: false,
        descriptionHidden: false,
        hasCancelReason: false,
        cancelReasonHidden: false,
        isCancelled: false,
      };
    }

    const slots = computeSlots(
      {
        totalSpots: row.totalSpots,
        captainCrew: Array(row.captainCrewLength).fill(""),
      } as Parameters<typeof computeSlots>[0],
      row.acceptedCount,
    );
    const status = deriveMatchStatus(
      {
        startTime: row.startTime,
        duration: row.duration,
        cancelledAt: row.cancelledAt,
      } as Parameters<typeof deriveMatchStatus>[0],
      slots,
      now,
    ) as AdminMatchStatus;

    return {
      kind: "match",
      matchId: row.id,
      venueName: row.venueName,
      startTime: row.startTime,
      status,
      isLive: LIVE_STATUSES.has(status),
      hasDescription:
        row.description !== null && row.description.trim().length > 0,
      descriptionHidden: row.descriptionHidden,
      hasCancelReason:
        row.cancelReason !== null && row.cancelReason.trim().length > 0,
      cancelReasonHidden: row.cancelReasonHidden,
      isCancelled: row.cancelledAt !== null,
    };
  }
}

function aggregate(reports: readonly Report[]): ReportStatus {
  let hasReviewed = false;
  for (const r of reports) {
    if (r.status === "new") return "new";
    if (r.status === "reviewed") hasReviewed = true;
  }
  return hasReviewed ? "reviewed" : "dismissed";
}
