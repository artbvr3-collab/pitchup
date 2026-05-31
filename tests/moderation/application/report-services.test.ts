/**
 * MODULE: tests.moderation.application.report-services
 * PURPOSE: Cover the Layer 9d report use cases — `SubmitReportService` (target
 *          validation, self-report guard, silent dedup) and
 *          `ListAdminReportsService` (grouping by target, aggregated-status
 *          ladder, sort, type/status filters, player + match + orphan target
 *          resolution).
 * LAYER: tests / application
 * TESTS FOR: src/moderation/application/{submit-report,list-admin-reports}-service.ts
 *
 * COMPOSITION: in-memory `FakeReportRepository` + reused `FakeUserRepository` /
 * `FakeMatchRepository` from the match_lifecycle helpers for the submit path; a
 * focused stub `matchRepository.findForAdminByIds` for the list path (the
 * shared fake returns []).
 *
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/reports".
 */
import { beforeEach, describe, expect, it } from "vitest";

import { asUserId } from "@/src/auth/domain/user";
import type { AdminMatchRow, MatchRepository } from "@/src/match_lifecycle/domain/match-repository";
import {
  CannotReportSelfError,
  ReportTargetNotFoundError,
} from "@/src/moderation/domain/errors";
import type {
  NewReportInput,
  Report,
  ReportType,
  SubmitReportOutcome,
} from "@/src/moderation/domain/report";
import type {
  ListReportsForAdminOptions,
  ReportRepository,
} from "@/src/moderation/domain/report-repository";
import { ListAdminReportsService } from "@/src/moderation/application/list-admin-reports-service";
import { SubmitReportService } from "@/src/moderation/application/submit-report-service";

import {
  FakeMatchRepository,
  FakeUserRepository,
  SEED_CAPTAIN_ID,
  SEED_MATCH_ID,
  SEED_PLAYER_ID,
  OTHER_PLAYER_ID,
  makeMatch,
  makeUser,
} from "../../match_lifecycle/_helpers/fakes";

const NOW = new Date("2026-05-31T12:00:00Z");
const REPORTER_ID = asUserId("99999999-9999-9999-9999-999999999999");

// ── In-memory report repository ────────────────────────────────────────────

type MutableReport = {
  -readonly [K in keyof Report]: Report[K];
};

class FakeReportRepository implements ReportRepository {
  readonly rows: MutableReport[] = [];
  private seq = 0;

  seed(row: Partial<Report> & Pick<Report, "type">): void {
    this.seq += 1;
    this.rows.push({
      id: row.id ?? `seed-${this.seq}`,
      reporterId: row.reporterId ?? REPORTER_ID,
      type: row.type,
      targetMatchId: row.targetMatchId ?? null,
      targetUserId: row.targetUserId ?? null,
      comment: row.comment ?? "bad",
      status: row.status ?? "new",
      createdAt: row.createdAt ?? NOW,
      reviewedAt: row.reviewedAt ?? null,
      reviewedBy: row.reviewedBy ?? null,
    });
  }

  async insertIfAbsent(input: NewReportInput): Promise<SubmitReportOutcome> {
    const dup = this.rows.find(
      (r) =>
        r.reporterId === input.reporterId &&
        r.type === input.type &&
        r.targetMatchId === input.targetMatchId &&
        r.targetUserId === input.targetUserId,
    );
    if (dup) return "duplicate";
    this.seq += 1;
    this.rows.push({
      id: `ins-${this.seq}`,
      reporterId: input.reporterId,
      type: input.type,
      targetMatchId: input.targetMatchId,
      targetUserId: input.targetUserId,
      comment: input.comment,
      status: "new",
      createdAt: NOW,
      reviewedAt: null,
      reviewedBy: null,
    });
    return "inserted";
  }

  async listAllForAdmin(
    options: ListReportsForAdminOptions,
  ): Promise<readonly Report[]> {
    return this.rows
      .filter((r) => !options.type || r.type === options.type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit);
  }

  async findById(id: string): Promise<Report | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async markAllNewReviewed(
    type: ReportType,
    targetId: string,
    reviewedBy: string,
    now: Date,
  ): Promise<number> {
    let n = 0;
    for (const r of this.rows) {
      const t = type === "player" ? r.targetUserId : r.targetMatchId;
      if (r.type === type && t === targetId && r.status === "new") {
        r.status = "reviewed";
        r.reviewedAt = now;
        r.reviewedBy = reviewedBy;
        n += 1;
      }
    }
    return n;
  }

  async markDismissed(
    reportId: string,
    reviewedBy: string,
    now: Date,
  ): Promise<boolean> {
    const r = this.rows.find((x) => x.id === reportId);
    if (!r) return false;
    r.status = "dismissed";
    r.reviewedAt = now;
    r.reviewedBy = reviewedBy;
    return true;
  }
}

function makeAdminMatchRow(over: Partial<AdminMatchRow> = {}): AdminMatchRow {
  return {
    id: SEED_MATCH_ID,
    venueName: "Riegrovy Sady",
    captainName: "Cap",
    captainId: SEED_CAPTAIN_ID,
    startTime: new Date("2026-06-10T18:00:00Z"),
    duration: 90,
    totalSpots: 10,
    captainCrewLength: 0,
    acceptedCount: 0,
    cancelledAt: null,
    description: "come play",
    descriptionHidden: false,
    cancelReason: null,
    cancelReasonHidden: false,
    updatedAt: NOW,
    ...over,
  };
}

/** Focused match repo whose only used method is findForAdminByIds. */
function stubMatchRepo(rows: AdminMatchRow[]): MatchRepository {
  return {
    findForAdminByIds: async (ids: readonly string[]) =>
      rows.filter((r) => ids.includes(r.id)),
  } as unknown as MatchRepository;
}

// ── SubmitReportService ─────────────────────────────────────────────────────

describe("SubmitReportService", () => {
  let reports: FakeReportRepository;
  let users: FakeUserRepository;
  let matches: FakeMatchRepository;
  let service: SubmitReportService;

  beforeEach(() => {
    reports = new FakeReportRepository();
    users = new FakeUserRepository();
    matches = new FakeMatchRepository();
    service = new SubmitReportService(reports, users, matches);
    users.seed(makeUser({ id: SEED_PLAYER_ID, name: "Target" }));
  });

  it("inserts a player report and reports deduped=false", async () => {
    const res = await service.execute({
      reporterId: REPORTER_ID,
      type: "player",
      targetId: SEED_PLAYER_ID,
      comment: "rude",
    });
    expect(res.deduped).toBe(false);
    expect(reports.rows).toHaveLength(1);
    expect(reports.rows[0]!.targetUserId).toBe(SEED_PLAYER_ID);
    expect(reports.rows[0]!.targetMatchId).toBeNull();
  });

  it("silently deduplicates a repeat report on the same target", async () => {
    const input = {
      reporterId: REPORTER_ID,
      type: "player" as const,
      targetId: SEED_PLAYER_ID,
      comment: "rude",
    };
    await service.execute(input);
    const second = await service.execute(input);
    expect(second.deduped).toBe(true);
    expect(reports.rows).toHaveLength(1);
  });

  it("rejects a self-report with CannotReportSelfError", async () => {
    users.seed(makeUser({ id: REPORTER_ID, name: "Me" }));
    await expect(
      service.execute({
        reporterId: REPORTER_ID,
        type: "player",
        targetId: REPORTER_ID,
        comment: "self",
      }),
    ).rejects.toBeInstanceOf(CannotReportSelfError);
  });

  it("404s a missing player target", async () => {
    await expect(
      service.execute({
        reporterId: REPORTER_ID,
        type: "player",
        targetId: OTHER_PLAYER_ID,
        comment: "ghost",
      }),
    ).rejects.toBeInstanceOf(ReportTargetNotFoundError);
  });

  it("404s a banned player target (privacy parity)", async () => {
    users.seed(makeUser({ id: OTHER_PLAYER_ID, name: "Banned", banned: true }));
    await expect(
      service.execute({
        reporterId: REPORTER_ID,
        type: "player",
        targetId: OTHER_PLAYER_ID,
        comment: "x",
      }),
    ).rejects.toBeInstanceOf(ReportTargetNotFoundError);
  });

  it("404s a soft-deleted player target", async () => {
    users.seed(
      makeUser({ id: OTHER_PLAYER_ID, name: "Gone", deletedAt: NOW }),
    );
    await expect(
      service.execute({
        reporterId: REPORTER_ID,
        type: "player",
        targetId: OTHER_PLAYER_ID,
        comment: "x",
      }),
    ).rejects.toBeInstanceOf(ReportTargetNotFoundError);
  });

  it("inserts a match report when the match exists", async () => {
    matches.put(makeMatch());
    const res = await service.execute({
      reporterId: REPORTER_ID,
      type: "match",
      targetId: SEED_MATCH_ID,
      comment: "spam match",
    });
    expect(res.deduped).toBe(false);
    expect(reports.rows[0]!.targetMatchId).toBe(SEED_MATCH_ID);
    expect(reports.rows[0]!.targetUserId).toBeNull();
  });

  it("404s a missing match target", async () => {
    await expect(
      service.execute({
        reporterId: REPORTER_ID,
        type: "match",
        targetId: SEED_MATCH_ID,
        comment: "x",
      }),
    ).rejects.toBeInstanceOf(ReportTargetNotFoundError);
  });
});

// ── ListAdminReportsService ─────────────────────────────────────────────────

describe("ListAdminReportsService", () => {
  let reports: FakeReportRepository;
  let users: FakeUserRepository;

  beforeEach(() => {
    reports = new FakeReportRepository();
    users = new FakeUserRepository();
    users.seed(makeUser({ id: SEED_PLAYER_ID, name: "Target Player" }));
    users.seed(makeUser({ id: REPORTER_ID, name: "Reporter One" }));
    users.seed(makeUser({ id: OTHER_PLAYER_ID, name: "Reporter Two" }));
  });

  function makeService(rows: AdminMatchRow[] = []) {
    return new ListAdminReportsService(reports, users, stubMatchRepo(rows));
  }

  it("groups multiple reports on the same player target into one row", async () => {
    reports.seed({
      type: "player",
      targetUserId: SEED_PLAYER_ID,
      reporterId: REPORTER_ID,
      createdAt: new Date("2026-05-30T10:00:00Z"),
    });
    reports.seed({
      type: "player",
      targetUserId: SEED_PLAYER_ID,
      reporterId: OTHER_PLAYER_ID,
      createdAt: new Date("2026-05-31T09:00:00Z"),
    });

    const { groups } = await makeService().execute(
      { typeFilter: null, statusFilter: null },
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.reportCount).toBe(2);
    expect(groups[0]!.aggregatedStatus).toBe("new");
    // Newest-first: last reporter is the 05-31 one.
    expect(groups[0]!.reports[0]!.reporterName).toBe("Reporter Two");
    expect(groups[0]!.target.kind).toBe("player");
  });

  it("applies the aggregated-status ladder (any new → New)", async () => {
    reports.seed({ type: "player", targetUserId: SEED_PLAYER_ID, status: "reviewed" });
    reports.seed({ type: "player", targetUserId: SEED_PLAYER_ID, status: "new" });
    const { groups } = await makeService().execute(
      { typeFilter: null, statusFilter: null },
      NOW,
    );
    expect(groups[0]!.aggregatedStatus).toBe("new");
  });

  it("ladders to Reviewed when no new but some reviewed", async () => {
    reports.seed({ type: "player", targetUserId: SEED_PLAYER_ID, status: "reviewed" });
    reports.seed({ type: "player", targetUserId: SEED_PLAYER_ID, status: "dismissed" });
    const { groups } = await makeService().execute(
      { typeFilter: null, statusFilter: null },
      NOW,
    );
    expect(groups[0]!.aggregatedStatus).toBe("reviewed");
  });

  it("sorts New groups above Reviewed, then by latest report DESC", async () => {
    // Player A: all dismissed (oldest)
    reports.seed({
      type: "player",
      targetUserId: SEED_PLAYER_ID,
      status: "dismissed",
      createdAt: new Date("2026-05-20T10:00:00Z"),
    });
    // Player B: new (newest)
    reports.seed({
      type: "player",
      targetUserId: OTHER_PLAYER_ID,
      status: "new",
      createdAt: new Date("2026-05-31T10:00:00Z"),
    });
    users.seed(makeUser({ id: OTHER_PLAYER_ID, name: "Player B" }));

    const { groups } = await makeService().execute(
      { typeFilter: null, statusFilter: null },
      NOW,
    );
    expect(groups[0]!.aggregatedStatus).toBe("new");
    expect(groups[1]!.aggregatedStatus).toBe("dismissed");
  });

  it("filters by aggregated status", async () => {
    reports.seed({ type: "player", targetUserId: SEED_PLAYER_ID, status: "new" });
    reports.seed({
      type: "player",
      targetUserId: OTHER_PLAYER_ID,
      status: "dismissed",
    });
    users.seed(makeUser({ id: OTHER_PLAYER_ID, name: "P2" }));

    const { groups } = await makeService().execute(
      { typeFilter: null, statusFilter: "dismissed" },
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.aggregatedStatus).toBe("dismissed");
  });

  it("resolves a player target name + removed flag", async () => {
    users.seed(
      makeUser({ id: OTHER_PLAYER_ID, name: "Banned Guy", banned: true }),
    );
    reports.seed({ type: "player", targetUserId: OTHER_PLAYER_ID });
    const { groups } = await makeService().execute(
      { typeFilter: null, statusFilter: null },
      NOW,
    );
    const target = groups[0]!.target;
    expect(target.kind).toBe("player");
    if (target.kind === "player") {
      expect(target.name).toBe("Banned Guy");
      expect(target.removed).toBe(true);
    }
  });

  it("resolves a live match target with derived status + hide flags", async () => {
    reports.seed({ type: "match", targetMatchId: SEED_MATCH_ID });
    const { groups } = await makeService([makeAdminMatchRow()]).execute(
      { typeFilter: null, statusFilter: null },
      NOW,
    );
    const target = groups[0]!.target;
    expect(target.kind).toBe("match");
    if (target.kind === "match") {
      expect(target.matchId).toBe(SEED_MATCH_ID);
      expect(target.venueName).toBe("Riegrovy Sady");
      expect(target.status).toBe("open");
      expect(target.isLive).toBe(true);
      expect(target.hasDescription).toBe(true);
      expect(target.isCancelled).toBe(false);
    }
  });

  it("renders an orphaned (admin-deleted) match target as its own group", async () => {
    // Two orphan match reports — must NOT collapse into one group.
    reports.seed({ type: "match", targetMatchId: null, id: "o1" });
    reports.seed({ type: "match", targetMatchId: null, id: "o2" });
    const { groups } = await makeService([]).execute(
      { typeFilter: null, statusFilter: null },
      NOW,
    );
    expect(groups).toHaveLength(2);
    for (const g of groups) {
      expect(g.target.kind).toBe("match");
      if (g.target.kind === "match") {
        expect(g.target.matchId).toBeNull();
        expect(g.target.venueName).toBe("[Deleted match]");
      }
    }
  });

  it("passes the type filter through to the repository", async () => {
    reports.seed({ type: "player", targetUserId: SEED_PLAYER_ID });
    reports.seed({ type: "match", targetMatchId: SEED_MATCH_ID });
    const { groups } = await makeService([makeAdminMatchRow()]).execute(
      { typeFilter: "match", statusFilter: null },
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.type).toBe("match");
  });

  it("falls back to [Unknown user] for an unresolved reporter", async () => {
    reports.seed({
      type: "player",
      targetUserId: SEED_PLAYER_ID,
      reporterId: asUserId("00000000-0000-0000-0000-000000000000"),
    });
    const { groups } = await makeService().execute(
      { typeFilter: null, statusFilter: null },
      NOW,
    );
    expect(groups[0]!.reports[0]!.reporterName).toBe("[Unknown user]");
  });
});
