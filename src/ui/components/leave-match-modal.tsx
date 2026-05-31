/**
 * MODULE: ui.components.leave-match-modal
 * PURPOSE: The Leave-flow modal (spec match.md → "Leave flow"). Title "Why are
 *          you leaving?", a required reason radio (Can't make it / Injury /
 *          Personal reasons / Other), a required free-text field when "Other"
 *          is picked, the "< 24h → organizer will be notified" warning, and
 *          [Confirm & leave] (destructive) / [Cancel]. Replaces the Layer-6
 *          native `confirm()` placeholder on the Leave CTA.
 * LAYER: ui (client)
 * DEPENDENCIES: react, ./modal, ./button
 * CONSUMED BY: app/matches/[id]/match-cta-bar.tsx
 * INVARIANTS:
 *   - `[Confirm & leave]` is disabled until a radio is selected, and (for
 *     "Other") until the text field is non-empty — spec requirement.
 *   - The resolved reason is the human label for the radios, or the trimmed
 *     text for "Other". Backend persistence / captain-visibility of the reason
 *     is a v1.1 follow-up (no `leave_reason` column yet); the value is sent in
 *     the POST /leave body so the wire format is forward-compatible.
 *   - The < 24h warning is informational only; it never blocks confirm.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Leave flow".
 */
"use client";

import { useState } from "react";

import { Button } from "./button";
import { Modal } from "./modal";

const REASONS = [
  "Can't make it",
  "Injury",
  "Personal reasons",
  "Other",
] as const;

export interface LeaveMatchModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Called with the resolved reason string when the user confirms. */
  readonly onConfirm: (reason: string) => void;
  /** Show the "organizer will be notified" warning (match < 24h away). */
  readonly within24h: boolean;
  /** Disables the confirm button while the leave request is in flight. */
  readonly busy: boolean;
}

export function LeaveMatchModal({
  open,
  onClose,
  onConfirm,
  within24h,
  busy,
}: LeaveMatchModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");

  const isOther = selected === "Other";
  const canConfirm =
    selected !== null && (!isOther || otherText.trim().length > 0);

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm(isOther ? otherText.trim() : (selected as string));
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabel="Why are you leaving?">
      <div className="flex flex-col gap-4">
        <h2 className="text-[17px] font-bold leading-tight text-text-primary">
          Why are you leaving?
        </h2>

        <div className="flex flex-col gap-1.5">
          {REASONS.map((reason) => (
            <label
              key={reason}
              className="flex cursor-pointer items-center gap-2.5 rounded-btn border border-border bg-bg-card px-3 py-2.5 text-[14px] text-text-primary"
            >
              <input
                type="radio"
                name="leave-reason"
                value={reason}
                checked={selected === reason}
                onChange={() => setSelected(reason)}
                className="h-4 w-4 accent-green-dark"
              />
              {reason}
            </label>
          ))}
        </div>

        {isOther && (
          <input
            type="text"
            autoFocus
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            maxLength={200}
            placeholder="Tell the organizer why"
            className="w-full rounded-btn border border-border bg-bg-card px-3 py-2.5 text-[14px] text-text-primary placeholder:text-text-muted focus:border-green-dark focus:outline-none"
          />
        )}

        {within24h && (
          <p className="rounded-btn bg-destructive-bg px-3 py-2 text-[13px] text-destructive">
            The organizer will be notified.
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="flex-1"
            disabled={!canConfirm || busy}
            onClick={handleConfirm}
          >
            {busy ? "Leaving…" : "Confirm & leave"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
