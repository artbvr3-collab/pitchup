/**
 * MODULE: app.matches.id.captain-sheet
 * PURPOSE: Bottom sheet opened via `[Manage match]` (or `?sheet=captain`).
 *          Surfaces the pending request list (Approve / Reject — Layer 4),
 *          the watching counter, and Layer 6.5 captain destructive actions:
 *            · `[Edit match]`   → router.push(`/matches/[id]/edit`)
 *            · `[Cancel match]` → opens an inline confirmation modal with a
 *                                 200-char `cancel_reason` textarea, then
 *                                 `POST /api/matches/:id/cancel`.
 * LAYER: interfaces (client)
 * DEPENDENCIES: src/ui/components/button, src/ui/lib/cn
 * INVARIANTS:
 *   - Uses the shared `Sheet` primitive (src/ui/components/sheet) for the
 *     backdrop / Esc / scroll-lock mechanics (extracted in Layer 7). The
 *     inner content (drag handle, menu vs cancel-confirm mode) is owned here.
 *   - Approve `[✓]` disabled when `1 + guest_count > free` (spec §179).
 *   - The cancel modal stays inside this sheet (not a third nested level)
 *     — spec match.md "Captain sheet" → cancel UX. Confirm button is
 *     disabled while `cancelReason.trim() === ''` OR
 *     `cancelReason.length > 200` (spec §276 + global.md text validation).
 *   - `[Edit match]` only navigates; it does NOT pre-fetch. The edit page
 *     does its own RSC fetch + captures the freshest `updated_at` for the
 *     optimistic-concurrency check.
 *   - Sheet does NOT auto-close on match transitioning to InProgress —
 *     the polling loop updates `matchStatus` upstream; the parent unmounts
 *     this on the next render when the cascade switches branches.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Captain sheet", "Reject / Kick /
 *     Leave flows" → "Match cancellation" (§276 confirm modal),
 *     "/matches/:id/edit"
 *   - docs/spec/pitchup-spec-global.md → "Text field validation &
 *     sanitization" → cancel_reason 200 chars
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type {
  MatchStateLineup,
  MatchStateLineupPending,
} from "@/src/match_lifecycle/application/dto/match-state";
import { Button } from "@/src/ui/components/button";
import { Sheet } from "@/src/ui/components/sheet";
import { cn } from "@/src/ui/lib/cn";

export interface CaptainSheetProps {
  readonly matchId: string;
  readonly pending: readonly MatchStateLineupPending[];
  readonly watchingCount: number;
  readonly free: number;
  readonly onClose: () => void;
  readonly onChange: (updated: MatchStateLineup) => void;
}

type Mode = "menu" | "cancel-confirm";

export function CaptainSheet(props: CaptainSheetProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("menu");

  return (
    <Sheet
      open
      onClose={props.onClose}
      ariaLabel={mode === "cancel-confirm" ? "Cancel match" : "Manage match"}
    >
      <div className="flex flex-col gap-3 overflow-y-auto p-4">
        <div className="mx-auto h-1 w-12 rounded-full bg-border-strong" />
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">
            {mode === "cancel-confirm" ? "Cancel match" : "Manage match"}
          </h2>
          <button
            type="button"
            onClick={
              mode === "cancel-confirm"
                ? () => setMode("menu")
                : props.onClose
            }
            className="text-xs text-text-muted"
          >
            {mode === "cancel-confirm" ? "Back" : "Close"}
          </button>
        </div>

        {mode === "menu" ? (
          <MenuView
            matchId={props.matchId}
            pending={props.pending}
            watchingCount={props.watchingCount}
            free={props.free}
            onEdit={() => router.push(`/matches/${props.matchId}/edit`)}
            onCancel={() => setMode("cancel-confirm")}
          />
        ) : (
          <CancelConfirmView
            matchId={props.matchId}
            onCancelled={() => {
              // Match is now Cancelled — refresh the page so the RSC re-derives
              // status / hero banner / CTA cascade. The sheet unmounts via the
              // parent's `viewerRole`-gated render once status flips.
              router.refresh();
              props.onClose();
            }}
            onAbort={() => setMode("menu")}
          />
        )}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Menu view — original Layer 5 surface + Layer 6.5 Edit / Cancel buttons.
// ---------------------------------------------------------------------------

function MenuView({
  matchId,
  pending,
  watchingCount,
  free,
  onEdit,
  onCancel,
}: {
  matchId: string;
  pending: readonly MatchStateLineupPending[];
  watchingCount: number;
  free: number;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          Pending ({pending.length})
        </h3>
        {pending.length === 0 ? (
          <p className="text-sm text-text-muted">No pending requests</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {pending.map((p) => (
              <PendingItem
                key={p.request_id}
                pending={p}
                free={free}
                matchId={matchId}
                onActed={() => router.refresh()}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card border border-border bg-bg-card p-3 text-sm">
        <p className="text-text-secondary">
          <strong className="text-text-primary">{watchingCount}</strong>{" "}
          {watchingCount === 1 ? "person is" : "people are"} watching this
          match
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <Button variant="ghost" onClick={onEdit}>
          Edit match
        </Button>
        <Button variant="destructive-ghost" onClick={onCancel}>
          Cancel match
        </Button>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cancel-confirm view — textarea + counter + Confirm/Back.
// ---------------------------------------------------------------------------

const CANCEL_REASON_MAX = 200;

function CancelConfirmView({
  matchId,
  onCancelled,
  onAbort,
}: {
  matchId: string;
  onCancelled: () => void;
  onAbort: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedLen = reason.trim().length;
  const overflow = reason.length > CANCEL_REASON_MAX;
  const disabled = busy || trimmedLen === 0 || overflow;

  const counterColor =
    reason.length >= CANCEL_REASON_MAX
      ? "text-destructive"
      : reason.length >= CANCEL_REASON_MAX - 20
        ? "text-status-almost"
        : "text-text-muted";

  const submit = async () => {
    if (disabled) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancel_reason: reason }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          code?: string;
        } | null;
        // Spec match.md "Idempotency": already_cancelled is success-no-op.
        if (body?.code === "already_cancelled") {
          onCancelled();
          return;
        }
        setError(messageForCode(body?.code));
        return;
      }
      onCancelled();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="text-sm text-text-secondary">
        This will cancel the match for all players. The reason below is shown
        on the match page banner.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-secondary">
          Reason for cancellation
        </span>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="e.g. Field flooded, can't play tonight"
          className="w-full resize-none rounded-btn border border-border bg-bg-card p-2 text-sm focus:border-border-focus focus:outline-none"
          disabled={busy}
        />
        <span className={cn("text-right text-xs", counterColor)}>
          {reason.length}/{CANCEL_REASON_MAX}
        </span>
      </label>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Button
          variant="destructive-ghost"
          onClick={submit}
          disabled={disabled}
        >
          {busy ? "Cancelling…" : "Confirm cancel"}
        </Button>
        <Button variant="ghost" onClick={onAbort} disabled={busy}>
          Back
        </Button>
      </div>
    </>
  );
}

function messageForCode(code: string | undefined): string {
  switch (code) {
    case "not_captain":
      return "Only the captain can cancel this match.";
    case "match_already_started":
      return "Match has already started — cancel is no longer possible.";
    case "validation_failed":
      return "Reason is required (1–200 characters).";
    case "match_not_found":
      return "Match not found.";
    default:
      return "Couldn't cancel the match. Try again.";
  }
}

// ---------------------------------------------------------------------------
// Pending row — unchanged from Layer 5 except styling is shared.
// ---------------------------------------------------------------------------

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
