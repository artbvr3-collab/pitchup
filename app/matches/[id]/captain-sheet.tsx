/**
 * MODULE: app.matches.id.captain-sheet
 * PURPOSE: Bottom sheet opened via `[Manage match]` (or `?sheet=captain`).
 *          In Layer 5 it surfaces the pending request list (Approve /
 *          Reject — backed by Layer 4 endpoints), the watching counter,
 *          and the kicked-down placeholders for `[Edit match]` /
 *          `[Cancel match]` (disabled with `Coming soon`).
 * LAYER: interfaces (client)
 * DEPENDENCIES: src/ui/components/button, src/ui/lib/cn
 * INVARIANTS:
 *   - Hand-rolled bottom-sheet pattern (same as MoreFiltersSheet in
 *     /games — backdrop click + Esc close + body-scroll lock). Layer 5+
 *     should extract this into a shared `Sheet` primitive (AGENTS notes
 *     mention this as a planned refactor).
 *   - Approve is disabled when `1 + guest_count > free` (spec §179).
 *   - Sheet does NOT auto-close on match transitioning to InProgress —
 *     the polling loop will update `matchStatus` and the parent unmounts
 *     this on the next render when the cascade switches branches.
 *     (The spec's 30s timer for self-close is a Layer 6 concern.)
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Captain sheet"
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  MatchStateLineup,
  MatchStateLineupPending,
} from "@/src/match_lifecycle/application/dto/match-state";
import { Button } from "@/src/ui/components/button";
import { cn } from "@/src/ui/lib/cn";

export interface CaptainSheetProps {
  readonly matchId: string;
  readonly pending: readonly MatchStateLineupPending[];
  readonly watchingCount: number;
  readonly free: number;
  readonly onClose: () => void;
  readonly onChange: (updated: MatchStateLineup) => void;
}

export function CaptainSheet(props: CaptainSheetProps) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [props]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-black/40"
        onClick={props.onClose}
        aria-hidden="true"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-[375px] flex-col gap-3 rounded-t-card bg-bg-base p-4 shadow-card">
        <div className="mx-auto h-1 w-12 rounded-full bg-border-strong" />
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Manage match</h2>
          <button
            type="button"
            onClick={props.onClose}
            className="text-xs text-text-muted"
          >
            Close
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Pending ({props.pending.length})
          </h3>
          {props.pending.length === 0 ? (
            <p className="text-sm text-text-muted">No pending requests</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {props.pending.map((p) => (
                <PendingItem
                  key={p.request_id}
                  pending={p}
                  free={props.free}
                  matchId={props.matchId}
                  onActed={() => router.refresh()}
                />
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-card border border-border bg-bg-card p-3 text-sm">
          <p className="text-text-secondary">
            <strong className="text-text-primary">
              {props.watchingCount}
            </strong>{" "}
            {props.watchingCount === 1 ? "person is" : "people are"} watching
            this match
          </p>
        </section>

        <section className="flex flex-col gap-1.5">
          <Button variant="ghost" disabled title="Coming in Layer 6">
            Edit match
          </Button>
          <Button
            variant="destructive-ghost"
            disabled
            title="Coming in Layer 6"
          >
            Cancel match
          </Button>
        </section>
      </div>
    </div>
  );
}

function PendingItem({
  pending,
  free,
  matchId,
  onActed,
}: {
  pending: MatchStateLineupPending;
  free: number;
  matchId: string;
  onActed: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const slotsNeeded = 1 + pending.guest_count;
  const approveDisabled = slotsNeeded > free;

  const act = async (action: "approve" | "reject") => {
    setBusy(action);
    try {
      const res = await fetch(`/api/matches/${matchId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: pending.request_id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { code?: string }
          | null;
        alert(`${action} failed: ${body?.code ?? res.status}`);
        return;
      }
      onActed();
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="flex items-center gap-2 rounded-btn border border-border bg-bg-card p-2">
      <div className="flex-1">
        <p className="text-sm font-medium">
          {pending.user.banned ? "[Removed user]" : pending.user.name}
          {pending.guest_count > 0 ? (
            <span className="ml-1.5 text-xs text-text-muted">
              +{pending.guest_count}
            </span>
          ) : null}
        </p>
        {pending.message ? (
          <p className="text-xs text-text-muted line-clamp-2">
            {pending.message}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => act("approve")}
        disabled={approveDisabled || busy !== null}
        title={
          approveDisabled
            ? "Not enough spots — increase Total or reject"
            : "Approve"
        }
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
          approveDisabled
            ? "bg-bg-surface text-text-muted"
            : "bg-green-dark text-text-inverted",
        )}
      >
        ✓
      </button>
      <button
        type="button"
        onClick={() => act("reject")}
        disabled={busy !== null}
        title="Reject"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive-bg text-sm font-bold text-destructive"
      >
        ✗
      </button>
    </li>
  );
}
