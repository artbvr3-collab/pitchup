/**
 * MODULE: app.admin.matches.admin-matches-table
 * PURPOSE: Client island for the `/admin/matches` table. Handles all row
 *          actions: Edit (navigate), Cancel (modal), Hide text (dropdown toggle),
 *          Delete (confirm + hard delete).
 * LAYER: interfaces (client)
 * DEPENDENCIES: next/navigation, next/link, src/ui/components/sheet
 * CONSUMED BY: app/admin/matches/page.tsx
 * INVARIANTS:
 *   - Edit → navigates to `/admin/matches/:id/edit` (admin-gated edit page).
 *     Disabled for InProgress / Ended / Cancelled.
 *   - Cancel → modal with reason textarea (1..200 chars). Same restrictions as
 *     captain cancel (disabled for InProgress / Ended / Cancelled). POST to
 *     `/api/admin/matches/:id/cancel`.
 *   - Hide text → dropdown with two checkboxes (description / cancel reason).
 *     Instant toggle — no Save. Available for ALL statuses.
 *   - Delete → confirm dialog, hard delete. Available for ALL statuses.
 *     `DELETE /api/admin/matches/:id`.
 *   - Row click (outside buttons) → `/matches/:id` in a new tab.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/matches".
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";

import type { AdminMatchStatus } from "@/src/match_lifecycle/composition";

export interface AdminMatchTableRow {
  readonly id: string;
  readonly venueName: string;
  readonly captainName: string;
  readonly captainId: string;
  readonly dateLabel: string;
  readonly status: AdminMatchStatus;
  readonly participants: number;
  readonly totalSpots: number;
  readonly descriptionHidden: boolean;
  readonly cancelReasonHidden: boolean;
  readonly hasDescription: boolean;
  readonly hasCancelReason: boolean;
  readonly updatedAt: string;
}

const STATUS_LABEL: Record<AdminMatchStatus, string> = {
  open: "Open",
  almostFull: "Almost full",
  full: "Full",
  inProgress: "In progress",
  ended: "Ended",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<AdminMatchStatus, string> = {
  open: "text-green-700",
  almostFull: "text-yellow-700",
  full: "text-red-600",
  inProgress: "text-blue-700",
  ended: "text-text-secondary",
  cancelled: "text-text-secondary",
};

const LIVE_STATUSES = new Set<AdminMatchStatus>(["open", "almostFull", "full"]);

function isLive(status: AdminMatchStatus) {
  return LIVE_STATUSES.has(status);
}

interface AdminMatchesTableProps {
  readonly rows: AdminMatchTableRow[];
}

export function AdminMatchesTable({ rows }: AdminMatchesTableProps) {
  const router = useRouter();
  const [localRows, setLocalRows] = useState(rows);

  // Keep local state in sync when the RSC re-renders (filter change).
  useEffect(() => {
    setLocalRows(rows);
  }, [rows]);

  function updateRow(id: string, patch: Partial<AdminMatchTableRow>) {
    setLocalRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  if (localRows.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-text-secondary">
        No records yet.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-border text-text-secondary">
            <th className="py-2 pl-4 pr-2 font-medium">Venue / date</th>
            <th className="py-2 px-2 font-medium">Captain</th>
            <th className="py-2 px-2 font-medium">Status</th>
            <th className="py-2 px-2 font-medium">Players</th>
            <th className="py-2 pl-2 pr-4 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {localRows.map((row) => (
            <AdminMatchRow
              key={row.id}
              row={row}
              onUpdate={(patch) => updateRow(row.id, patch)}
              onDeleted={() =>
                setLocalRows((prev) => prev.filter((r) => r.id !== row.id))
              }
              router={router}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Row component ──────────────────────────────────────────────────────────

interface AdminMatchRowProps {
  row: AdminMatchTableRow;
  onUpdate: (patch: Partial<AdminMatchTableRow>) => void;
  onDeleted: () => void;
  router: ReturnType<typeof useRouter>;
}

function AdminMatchRow({ row, onUpdate, onDeleted, router }: AdminMatchRowProps) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [hideOpen, setHideOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const hideRef = useRef<HTMLDivElement>(null);

  // Close hide dropdown on outside click.
  useEffect(() => {
    if (!hideOpen) return;
    const handler = (e: MouseEvent) => {
      if (hideRef.current && !hideRef.current.contains(e.target as Node)) {
        setHideOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [hideOpen]);

  const anyHidden = row.descriptionHidden || row.cancelReasonHidden;

  return (
    <>
      <tr
        className="border-b border-border hover:bg-bg-muted/40 cursor-pointer"
        onClick={() => window.open(`/matches/${row.id}`, "_blank")}
      >
        <td className="py-2.5 pl-4 pr-2">
          <div className="font-medium leading-tight">{row.venueName}</div>
          <div className="text-text-secondary text-[12px]">{row.dateLabel}</div>
        </td>
        <td className="py-2.5 px-2">
          <Link
            href={`/users/${row.captainId}`}
            target="_blank"
            className="hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.captainName}
          </Link>
        </td>
        <td className={`py-2.5 px-2 font-medium ${STATUS_COLOR[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </td>
        <td className="py-2.5 px-2">
          {row.participants}/{row.totalSpots}
        </td>
        <td
          className="py-2.5 pl-2 pr-4 text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-end gap-1.5">
            {/* Edit */}
            <button
              disabled={!isLive(row.status)}
              onClick={() => router.push(`/admin/matches/${row.id}/edit`)}
              className="rounded px-2 py-1 text-[12px] font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Edit
            </button>

            {/* Cancel */}
            <button
              disabled={!isLive(row.status)}
              onClick={() => setCancelOpen(true)}
              className="rounded px-2 py-1 text-[12px] font-medium text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Cancel
            </button>

            {/* Hide text */}
            <div className="relative" ref={hideRef}>
              <button
                onClick={() => setHideOpen((o) => !o)}
                className={`rounded px-2 py-1 text-[12px] font-medium hover:bg-primary/10 ${
                  anyHidden ? "text-orange-600" : "text-primary"
                }`}
              >
                {anyHidden ? "Hide text ⚑" : "Hide text ▾"}
              </button>
              {hideOpen && (
                <HideTextDropdown
                  row={row}
                  onUpdate={onUpdate}
                  onClose={() => setHideOpen(false)}
                />
              )}
            </div>

            {/* Delete */}
            <button
              onClick={() => setDeleteOpen(true)}
              className="rounded px-2 py-1 text-[12px] font-medium text-red-600 hover:bg-red-50"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>

      {cancelOpen && (
        <CancelModal
          matchId={row.id}
          onClose={() => setCancelOpen(false)}
          onSuccess={() => {
            setCancelOpen(false);
            router.refresh();
          }}
        />
      )}

      {deleteOpen && (
        <DeleteModal
          matchId={row.id}
          venueName={row.venueName}
          onClose={() => setDeleteOpen(false)}
          onSuccess={() => {
            setDeleteOpen(false);
            onDeleted();
          }}
        />
      )}
    </>
  );
}

// ─── Hide text dropdown ──────────────────────────────────────────────────────

function HideTextDropdown({
  row,
  onUpdate,
  onClose,
}: {
  row: AdminMatchTableRow;
  onUpdate: (patch: Partial<AdminMatchTableRow>) => void;
  onClose: () => void;
}) {
  async function toggle(field: "description_hidden" | "cancel_reason_hidden", value: boolean) {
    try {
      const res = await fetch(`/api/admin/matches/${row.id}/hide-text`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) return;
      const data: { description_hidden: boolean; cancel_reason_hidden: boolean } =
        await res.json();
      onUpdate({
        descriptionHidden: data.description_hidden,
        cancelReasonHidden: data.cancel_reason_hidden,
      });
    } catch {
      // best-effort
    }
  }

  const hasDesc = row.hasDescription;
  const hasCancelReason = row.hasCancelReason;

  if (!hasDesc && !hasCancelReason) {
    return (
      <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-bg-base p-3 shadow-lg text-[12px] text-text-secondary">
        Nothing to hide on this match.
        <button className="mt-2 block text-primary" onClick={onClose}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-border bg-bg-base p-3 shadow-lg">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        Hide text
      </p>
      {hasDesc && (
        <label className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
          <input
            type="checkbox"
            checked={row.descriptionHidden}
            onChange={(e) => toggle("description_hidden", e.target.checked)}
            className="h-4 w-4 accent-lime-600"
          />
          Hide description
        </label>
      )}
      {hasCancelReason && (
        <label className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
          <input
            type="checkbox"
            checked={row.cancelReasonHidden}
            onChange={(e) => toggle("cancel_reason_hidden", e.target.checked)}
            className="h-4 w-4 accent-lime-600"
          />
          Hide cancel reason
        </label>
      )}
    </div>
  );
}

// ─── Cancel modal ────────────────────────────────────────────────────────────

function CancelModal({
  matchId,
  onClose,
  onSuccess,
}: {
  matchId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/matches/${matchId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_reason: reason.trim() }),
      });
      if (res.status === 409) {
        const body = await res.json();
        if (body.code === "already_cancelled") {
          onSuccess(); // treat idempotently
          return;
        }
        setError(body.message ?? "Cannot cancel this match.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? "Something went wrong.");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <h2 className="mb-3 text-base font-bold">Cancel match</h2>
      <p className="mb-3 text-sm text-text-secondary">
        Players will be notified. This cannot be undone.
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 200))}
        placeholder="Reason for cancellation…"
        rows={3}
        className="w-full rounded-lg border border-border bg-bg-base px-3 py-2 text-sm outline-none focus:border-primary"
      />
      <div className="mt-1 text-right text-[11px] text-text-secondary">
        {reason.length}/200
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <div className="mt-4 flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm"
        >
          Close
        </button>
        <button
          onClick={submit}
          disabled={busy || !reason.trim()}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Cancelling…" : "Confirm cancel"}
        </button>
      </div>
    </Backdrop>
  );
}

// ─── Delete modal ────────────────────────────────────────────────────────────

function DeleteModal({
  matchId,
  venueName,
  onClose,
  onSuccess,
}: {
  matchId: string;
  venueName: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/matches/${matchId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? "Something went wrong.");
        return;
      }
      onSuccess();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Backdrop onClose={onClose}>
      <h2 className="mb-3 text-base font-bold text-red-600">Delete match</h2>
      <p className="mb-4 text-sm text-text-secondary">
        Permanently delete <span className="font-medium text-text-primary">{venueName}</span>?
        All data (join requests, chat, notifications) will be erased.
        Players will <strong>not</strong> be notified — use Cancel for legitimate matches.
      </p>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm"
        >
          Go back
        </button>
        <button
          onClick={submit}
          disabled={busy}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </Backdrop>
  );
}

// ─── Shared backdrop/modal ───────────────────────────────────────────────────

function Backdrop({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 sm:items-center"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-sm rounded-t-2xl bg-bg-base px-5 py-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
