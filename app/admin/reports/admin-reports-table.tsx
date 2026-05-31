/**
 * MODULE: app.admin.reports.admin-reports-table
 * PURPOSE: Client island for the `/admin/reports` list. Renders one row per
 *          target (grouped) and a `[Review]` bottom-sheet whose actions REUSE
 *          the existing admin endpoints (Ban / Cancel / Delete / Hide-text) and
 *          then flip report status via the dedicated report endpoints. Spec
 *          personal.md §348 — "no duplicated logic, [Review] opens the
 *          appropriate modal with the appropriate target_id".
 * LAYER: interfaces (client island)
 * DEPENDENCIES: next/navigation, next/link, src/ui/components/sheet
 * INVARIANTS:
 *   - A destructive action (Ban / Cancel / Delete) → `mark-reviewed` flips ALL
 *     `new` reports on the target to `reviewed`, then close + refresh.
 *   - Hide-description / Hide-cancel-reason toggles do NOT change report status
 *     (spec §342) — they PATCH hide-text and update local modal state only.
 *   - `[Dismiss]` flips ONLY the currently-open report (most recent `new`, else
 *     most recent overall) → `dismissed` (spec §322).
 *   - `[Cancel match]` visible only for live matches; `[Hide cancel reason]`
 *     only for cancelled matches; orphaned (admin-deleted) targets offer
 *     `[Dismiss]` only.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/reports".
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Sheet } from "@/src/ui/components/sheet";
import type { ReportStatus, ReportType } from "@/src/moderation/domain/report";

export interface AdminReportEntryRow {
  readonly id: string;
  readonly reporterName: string;
  readonly comment: string;
  readonly dateLabel: string;
  readonly status: ReportStatus;
}

export interface AdminReportMatchInfo {
  readonly matchId: string | null;
  readonly venueName: string;
  readonly dateLabel: string | null;
  readonly statusLabel: string | null;
  readonly isLive: boolean;
  readonly hasDescription: boolean;
  readonly descriptionHidden: boolean;
  readonly hasCancelReason: boolean;
  readonly cancelReasonHidden: boolean;
  readonly isCancelled: boolean;
}

export interface AdminReportPlayerInfo {
  readonly userId: string;
  readonly name: string;
  readonly removed: boolean;
}

export interface AdminReportTableRow {
  readonly key: string;
  readonly type: ReportType;
  readonly targetId: string | null;
  readonly reportCount: number;
  readonly aggregatedStatus: ReportStatus;
  readonly lastReportLabel: string;
  readonly lastReporterName: string;
  readonly player: AdminReportPlayerInfo | null;
  readonly match: AdminReportMatchInfo | null;
  readonly reports: readonly AdminReportEntryRow[];
}

const STATUS_LABEL: Record<ReportStatus, string> = {
  new: "New",
  reviewed: "Reviewed",
  dismissed: "Dismissed",
};

const STATUS_COLOR: Record<ReportStatus, string> = {
  new: "text-red-600",
  reviewed: "text-green-700",
  dismissed: "text-text-secondary",
};

export function AdminReportsTable({ rows }: { rows: AdminReportTableRow[] }) {
  const router = useRouter();
  const [reviewing, setReviewing] = useState<AdminReportTableRow | null>(null);

  if (rows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-text-secondary">
        No reports yet.
      </p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border text-text-secondary">
              <th className="py-2 pl-4 pr-2 font-medium">Type</th>
              <th className="py-2 px-2 font-medium">Target</th>
              <th className="py-2 px-2 font-medium">Reports</th>
              <th className="py-2 px-2 font-medium">Last report</th>
              <th className="py-2 px-2 font-medium">Status</th>
              <th className="py-2 pl-2 pr-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-border align-top">
                <td className="py-2.5 pl-4 pr-2 capitalize">{row.type}</td>
                <td className="py-2.5 px-2">
                  <TargetCell row={row} />
                </td>
                <td className="py-2.5 px-2">
                  {row.reportCount > 1 ? (
                    <span className="inline-flex items-center rounded-full bg-bg-surface px-2 py-0.5 text-[12px] font-semibold text-text-primary">
                      {row.reportCount} reports
                    </span>
                  ) : (
                    <span className="text-text-secondary">1 report</span>
                  )}
                </td>
                <td className="py-2.5 px-2">
                  <div className="leading-tight">{row.lastReporterName}</div>
                  <div className="text-[12px] text-text-secondary">
                    {row.lastReportLabel}
                  </div>
                </td>
                <td
                  className={`py-2.5 px-2 font-medium ${STATUS_COLOR[row.aggregatedStatus]}`}
                >
                  {STATUS_LABEL[row.aggregatedStatus]}
                </td>
                <td className="py-2.5 pl-2 pr-4 text-right">
                  <button
                    type="button"
                    onClick={() => setReviewing(row)}
                    className="rounded px-2 py-1 text-[12px] font-medium text-primary hover:bg-primary/10"
                  >
                    Review
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ReviewSheet
        row={reviewing}
        onClose={() => setReviewing(null)}
        onResolved={() => {
          setReviewing(null);
          router.refresh();
        }}
      />
    </>
  );
}

function TargetCell({ row }: { row: AdminReportTableRow }) {
  if (row.type === "player" && row.player) {
    if (row.player.userId === "") {
      return <span className="text-text-secondary">{row.player.name}</span>;
    }
    return (
      <Link
        href={`/users/${row.player.userId}`}
        target="_blank"
        className={`hover:underline ${row.player.removed ? "text-text-secondary" : ""}`}
      >
        {row.player.name}
      </Link>
    );
  }
  if (row.type === "match" && row.match) {
    const label = `${row.match.venueName}${
      row.match.dateLabel ? ` · ${row.match.dateLabel}` : ""
    }`;
    if (!row.match.matchId) {
      return <span className="text-text-secondary">{label}</span>;
    }
    return (
      <Link
        href={`/matches/${row.match.matchId}`}
        target="_blank"
        className="hover:underline"
      >
        {label}
      </Link>
    );
  }
  return <span className="text-text-secondary">—</span>;
}

// ─── Review sheet ────────────────────────────────────────────────────────────

type Mode = "menu" | "ban" | "cancel" | "delete" | "all";

function ReviewSheet({
  row,
  onClose,
  onResolved,
}: {
  row: AdminReportTableRow | null;
  onClose: () => void;
  onResolved: () => void;
}) {
  return (
    <Sheet open={row !== null} onClose={onClose} ariaLabel="Review report">
      {row && (
        <ReviewBody key={row.key} row={row} onClose={onClose} onResolved={onResolved} />
      )}
    </Sheet>
  );
}

function ReviewBody({
  row,
  onClose,
  onResolved,
}: {
  row: AdminReportTableRow;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [mode, setMode] = useState<Mode>("menu");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  // Local mirror of the hide flags so toggles reflect instantly.
  const [descHidden, setDescHidden] = useState(
    row.match?.descriptionHidden ?? false,
  );
  const [cancelHidden, setCancelHidden] = useState(
    row.match?.cancelReasonHidden ?? false,
  );

  // The "currently open" report: most recent `new`, else most recent overall.
  const openReport =
    row.reports.find((r) => r.status === "new") ?? row.reports[0]!;

  async function markReviewed(): Promise<boolean> {
    if (row.targetId === null) return true; // orphan — nothing to flip
    const res = await fetch("/api/admin/reports/mark-reviewed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: row.type, target_id: row.targetId }),
    });
    return res.ok;
  }

  async function runDestructive(action: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await action();
      // Treat "already cancelled" as success (idempotent).
      const ok =
        res.ok ||
        (res.status === 409 &&
          (await res
            .clone()
            .json()
            .catch(() => ({}))
            .then((b: { code?: string }) => b.code === "already_cancelled")));
      if (!ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(messageForCode(body.code));
        return;
      }
      await markReviewed();
      onResolved();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reports/${openReport.id}/dismiss`, {
        method: "POST",
      });
      if (!res.ok && res.status !== 404) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(messageForCode(body.code));
        return;
      }
      onResolved();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleHide(
    field: "description_hidden" | "cancel_reason_hidden",
    value: boolean,
  ) {
    if (!row.match?.matchId) return;
    try {
      const res = await fetch(
        `/api/admin/matches/${row.match.matchId}/hide-text`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        },
      );
      if (!res.ok) return;
      const data: {
        description_hidden: boolean;
        cancel_reason_hidden: boolean;
      } = await res.json();
      setDescHidden(data.description_hidden);
      setCancelHidden(data.cancel_reason_hidden);
    } catch {
      // best-effort
    }
  }

  // ── Sub-modes (reason / confirm forms) ──────────────────────────────────
  if (mode === "ban") {
    return (
      <FormMode
        title="Ban player"
        confirmLabel="Confirm ban"
        destructive
        reason={reason}
        setReason={setReason}
        maxLen={1000}
        placeholder="Reason for ban (required)"
        busy={busy}
        error={error}
        onBack={() => setMode("menu")}
        onConfirm={() =>
          runDestructive(() =>
            fetch(`/api/admin/users/${row.targetId}/ban`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reason: reason.trim() }),
            }),
          )
        }
      />
    );
  }
  if (mode === "cancel") {
    return (
      <FormMode
        title="Cancel match"
        confirmLabel="Confirm cancel"
        destructive
        reason={reason}
        setReason={setReason}
        maxLen={200}
        placeholder="Reason for cancellation (required)"
        busy={busy}
        error={error}
        onBack={() => setMode("menu")}
        onConfirm={() =>
          runDestructive(() =>
            fetch(`/api/admin/matches/${row.match!.matchId}/cancel`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cancel_reason: reason.trim() }),
            }),
          )
        }
      />
    );
  }
  if (mode === "delete") {
    return (
      <div className="flex flex-col gap-3 p-4">
        <h2 className="text-[17px] font-bold text-red-600">Delete match</h2>
        <p className="text-[13px] text-text-secondary">
          Permanently delete this match and all its data. Players are{" "}
          <strong>not</strong> notified — use Cancel for legitimate matches.
        </p>
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        <div className="flex gap-2">
          <SecondaryButton onClick={() => setMode("menu")} disabled={busy}>
            Back
          </SecondaryButton>
          <DangerButton
            disabled={busy}
            onClick={() =>
              runDestructive(() =>
                fetch(`/api/admin/matches/${row.match!.matchId}`, {
                  method: "DELETE",
                }),
              )
            }
          >
            {busy ? "Deleting…" : "Delete permanently"}
          </DangerButton>
        </div>
      </div>
    );
  }
  if (mode === "all") {
    return (
      <div className="flex max-h-[80vh] flex-col gap-3 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[17px] font-bold">All {row.reportCount} reports</h2>
          <button
            type="button"
            onClick={() => setMode("menu")}
            className="text-[13px] font-medium text-primary"
          >
            Back
          </button>
        </div>
        {row.reports.map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-3">
            <div className="mb-1 flex items-center justify-between text-[12px] text-text-secondary">
              <span>
                {r.reporterName} · {r.dateLabel}
              </span>
              <span className={STATUS_COLOR[r.status]}>
                {STATUS_LABEL[r.status]}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-[14px] text-text-primary">
              {r.comment}
            </p>
          </div>
        ))}
      </div>
    );
  }

  // ── Menu mode ────────────────────────────────────────────────────────────
  const isPlayer = row.type === "player";
  return (
    <div className="flex max-h-[85vh] flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-[17px] font-bold">
        {isPlayer ? "Report on player" : "Report on match"}
      </h2>

      {/* Target block */}
      {isPlayer && row.player ? (
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-surface text-[14px] font-bold text-text-muted">
            {row.player.name.charAt(0).toUpperCase() || "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">
              {row.player.name}
              {row.player.removed && (
                <span className="ml-1 text-[12px] font-normal text-text-muted">
                  (removed)
                </span>
              )}
            </div>
            {row.player.userId !== "" && (
              <Link
                href={`/users/${row.player.userId}`}
                target="_blank"
                className="text-[12px] text-green-dark underline"
              >
                View profile ↗
              </Link>
            )}
          </div>
        </div>
      ) : row.match ? (
        <div className="rounded-lg bg-bg-surface px-3 py-2 text-[13px]">
          <div className="font-semibold">{row.match.venueName}</div>
          <div className="text-text-secondary">
            {row.match.dateLabel ?? "—"}
            {row.match.statusLabel ? ` · ${row.match.statusLabel}` : ""}
          </div>
          {row.match.matchId && (
            <Link
              href={`/matches/${row.match.matchId}`}
              target="_blank"
              className="text-[12px] text-green-dark underline"
            >
              View match ↗
            </Link>
          )}
        </div>
      ) : null}

      {/* Open report comment */}
      <div className="rounded-lg border border-border p-3">
        <div className="mb-1 text-[12px] text-text-secondary">
          {openReport.reporterName} · {openReport.dateLabel}
        </div>
        <p className="whitespace-pre-wrap break-words text-[14px] text-text-primary">
          {openReport.comment}
        </p>
      </div>

      {row.reportCount > 1 && (
        <button
          type="button"
          onClick={() => setMode("all")}
          className="self-start text-[13px] font-medium text-primary"
        >
          View all {row.reportCount} reports
        </button>
      )}

      {/* Hide-text toggles (match only) */}
      {!isPlayer && row.match?.matchId && (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <label
            className={`flex items-center gap-2 text-[13px] ${
              row.match.hasDescription
                ? "cursor-pointer"
                : "cursor-not-allowed opacity-40"
            }`}
          >
            <input
              type="checkbox"
              disabled={!row.match.hasDescription}
              checked={descHidden}
              onChange={(e) => toggleHide("description_hidden", e.target.checked)}
              className="h-4 w-4 accent-lime-600"
            />
            Hide description
          </label>
          {row.match.isCancelled && (
            <label
              className={`flex items-center gap-2 text-[13px] ${
                row.match.hasCancelReason
                  ? "cursor-pointer"
                  : "cursor-not-allowed opacity-40"
              }`}
            >
              <input
                type="checkbox"
                disabled={!row.match.hasCancelReason}
                checked={cancelHidden}
                onChange={(e) =>
                  toggleHide("cancel_reason_hidden", e.target.checked)
                }
                className="h-4 w-4 accent-lime-600"
              />
              Hide cancel reason
            </label>
          )}
        </div>
      )}

      {error && <p className="text-[13px] text-destructive">{error}</p>}

      {/* Action buttons */}
      <div className="flex flex-col gap-2 border-t border-border pt-3">
        {isPlayer ? (
          <DangerButton
            disabled={busy || row.targetId === null}
            onClick={() => {
              setReason("");
              setError(null);
              setMode("ban");
            }}
          >
            Ban player
          </DangerButton>
        ) : (
          <>
            {row.match?.isLive && (
              <DangerButton
                disabled={busy}
                onClick={() => {
                  setReason("");
                  setError(null);
                  setMode("cancel");
                }}
              >
                Cancel match
              </DangerButton>
            )}
            {row.match?.matchId && (
              <DangerButton
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setMode("delete");
                }}
              >
                Delete match
              </DangerButton>
            )}
          </>
        )}
        <div className="flex gap-2">
          <SecondaryButton onClick={onClose} disabled={busy}>
            Close
          </SecondaryButton>
          <SecondaryButton onClick={dismiss} disabled={busy}>
            {busy ? "…" : "Dismiss"}
          </SecondaryButton>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable form-mode (ban / cancel reason) ────────────────────────────────

function FormMode({
  title,
  confirmLabel,
  reason,
  setReason,
  maxLen,
  placeholder,
  busy,
  error,
  onBack,
  onConfirm,
}: {
  title: string;
  confirmLabel: string;
  destructive: boolean;
  reason: string;
  setReason: (v: string) => void;
  maxLen: number;
  placeholder: string;
  busy: boolean;
  error: string | null;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <h2 className="text-[17px] font-bold">{title}</h2>
      <textarea
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, maxLen))}
        placeholder={placeholder}
        rows={3}
        className="w-full resize-none rounded-lg border-[1.5px] border-border bg-bg-card p-2.5 text-[14px] outline-none focus:border-green-dark"
      />
      <div className="text-right text-[11px] text-text-muted">
        {reason.length}/{maxLen}
      </div>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      <div className="flex gap-2">
        <SecondaryButton onClick={onBack} disabled={busy}>
          Back
        </SecondaryButton>
        <DangerButton disabled={busy || reason.trim().length === 0} onClick={onConfirm}>
          {busy ? "…" : confirmLabel}
        </DangerButton>
      </div>
    </div>
  );
}

// ─── Small buttons ───────────────────────────────────────────────────────────

function DangerButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-10 flex-1 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-10 flex-1 rounded-lg border border-border px-4 text-sm font-medium text-text-primary transition-colors hover:bg-bg-surface disabled:opacity-50"
    >
      {children}
    </button>
  );
}

const ERROR_MESSAGES: Record<string, string> = {
  self_modification: "You cannot modify your own account.",
  last_admin: "Cannot remove the last remaining admin.",
  user_not_found: "User not found.",
  match_not_found: "Match not found.",
  already_cancelled: "Match was already cancelled.",
  match_already_started: "Match has already started.",
  admin_required: "You no longer have admin rights.",
  forbidden: "You no longer have admin rights.",
  report_not_found: "This report no longer exists.",
};

function messageForCode(code: string | undefined): string {
  return (code && ERROR_MESSAGES[code]) ?? "Something went wrong. Try again.";
}
