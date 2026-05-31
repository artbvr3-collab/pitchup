/**
 * MODULE: ui.components.report-submission-modal
 * PURPOSE: Shared bottom-sheet form for submitting an abuse report on a match
 *          or a player (`POST /api/reports`). Used by both the match `[⋯]`
 *          menu (`/matches/:id`) and the player `[⋯]` menu (`/users/:id`) —
 *          the copy differs only by `type`.
 * LAYER: ui (client)
 * DEPENDENCIES: src/ui/components/{sheet, button}
 * INVARIANTS:
 *   - Only rendered/opened for SIGNED-IN users — guests are intercepted earlier
 *     (the menus route them to `/login`). The route still enforces `requireAuth`.
 *   - Comment is required, ≤500 chars (spec global.md "Limits"). The Submit
 *     button is disabled until non-empty.
 *   - Success AND silent-dedup both yield the same toast + close (spec: a repeat
 *     report returns 200, "no toast spam" — the user can't tell, by design).
 *   - 401 → the session was lost mid-session; bounce to `/login`.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "Submission modal".
 */
"use client";

import { useState } from "react";

import { Button } from "@/src/ui/components/button";
import { Sheet } from "@/src/ui/components/sheet";

export interface ReportSubmissionModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly type: "match" | "player";
  readonly targetId: string;
}

const COPY = {
  match: { title: "Report this match" },
  player: { title: "Report this player" },
} as const;

export function ReportSubmissionModal({
  open,
  onClose,
  type,
  targetId,
}: ReportSubmissionModalProps) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setComment("");
    setError(null);
    onClose();
  }

  async function submit() {
    const trimmed = comment.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, target_id: targetId, comment: trimmed }),
      });
      if (res.status === 401) {
        window.location.href = `/login?callbackUrl=${encodeURIComponent(
          window.location.pathname,
        )}`;
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { code?: string };
        setError(
          body.code === "report_target_not_found"
            ? "This is no longer available to report."
            : "Something went wrong. Try again.",
        );
        return;
      }
      // Success or silent dedup — identical UX.
      window.alert("Report submitted. Thank you.");
      setComment("");
      onClose();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={close} ariaLabel={COPY[type].title}>
      <div className="flex flex-col gap-3 p-4">
        <h2 className="text-[17px] font-bold">{COPY[type].title}</h2>
        <p className="text-[13px] text-text-secondary">
          We review all reports within 24 hours.
        </p>
        <label className="text-[13px] font-medium text-text-primary">
          What&rsquo;s the issue?
        </label>
        <textarea
          autoFocus
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 500))}
          placeholder="Describe the problem…"
          rows={4}
          className="w-full resize-none rounded-lg border-[1.5px] border-border bg-bg-card p-2.5 text-[14px] outline-none focus:border-green-dark"
        />
        <div className="text-right text-[11px] text-text-muted">
          {comment.length}/500
        </div>
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button variant="ghost" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy || comment.trim().length === 0}
          >
            {busy ? "Submitting…" : "Submit report"}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
