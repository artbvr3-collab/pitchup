/**
 * MODULE: app.(private).me.delete-account-modal
 * PURPOSE: The "Delete account" row + its confirm modal. Owns the spec
 *          personal.md §145–150 branch logic (last-admin blocker vs.
 *          captain-upcoming vs. accepted-upcoming vs. plain "history"
 *          copy) and the DELETE /api/me → signOut → redirect flow.
 * LAYER: interfaces (client island)
 * DEPENDENCIES: next/navigation, ./actions (signOutAction)
 * INVARIANTS:
 *   - The branch text is decided BY THE SERVER (RSC passes the three flags
 *     in via props). The client renders verbatim — no extra branching.
 *     This is the spec mirror of the DELETE /api/me last-admin backstop.
 *   - The trigger button is destructive-styled (red) but NOT disabled even
 *     for the last-admin case: tap still opens the modal so the user reads
 *     why they can't proceed. The disabled state is on `[Delete account]`
 *     INSIDE the modal, not on the row.
 *   - `signOutAction()` is the existing Server Action used by the regular
 *     Sign-out row. Reused so cookie deletion + redirect stay in one place.
 *     On unexpected backend failure (5xx) we surface a toast and do NOT
 *     sign out — the user can retry.
 *   - 409 `last_admin` from the backstop (UI stale, e.g. tab open while a
 *     promote race happened) → show the blocking text inside the modal +
 *     keep the page intact. Doesn't redirect.
 *   - Modal a11y is shared with Sheet primitives: backdrop click + Esc +
 *     scroll lock. We hand-roll it here (not via `Sheet`) because the
 *     visual is a center-aligned dialog, not a bottom-sheet — same family,
 *     different geometry.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/me" → Section ACCOUNT ACTIONS
 *     → Delete account
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion"
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { signOutAction } from "./actions";

export interface DeleteAccountModalProps {
  /** Caller is the only active admin → block, do not allow delete. */
  readonly isLastAdmin: boolean;
  /** Captain of N upcoming, not-yet-cancelled matches. */
  readonly captainUpcomingCount: number;
  /** Accepted in N upcoming, not-yet-cancelled OTHER matches. */
  readonly acceptedUpcomingCount: number;
}

type DeletionState =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "error"; readonly message: string };

export function DeleteAccountModal(props: DeleteAccountModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeletionState>({ kind: "idle" });

  // Esc to close + body-scroll lock while open (mirrors Sheet primitive).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.kind !== "submitting") setOpen(false);
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, state.kind]);

  const onConfirm = async () => {
    if (props.isLastAdmin) return; // button is disabled but be safe
    setState({ kind: "submitting" });
    try {
      const res = await fetch("/api/me", {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (res.status === 204) {
        // Server Action handles the cookie + redirect. After signOut
        // returns, the page is /, so we're done.
        await signOutAction();
        // Defensive: if signOutAction didn't redirect (shouldn't happen),
        // do it client-side.
        router.push("/");
        return;
      }
      if (res.status === 409) {
        setState({
          kind: "error",
          message:
            "You're the only admin. Promote another user to admin first.",
        });
        return;
      }
      setState({
        kind: "error",
        message: "Couldn't delete the account. Try again.",
      });
    } catch {
      setState({
        kind: "error",
        message: "Network error. Try again.",
      });
    }
  };

  const submitting = state.kind === "submitting";
  const disabled = props.isLastAdmin || submitting;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setState({ kind: "idle" });
          setOpen(true);
        }}
        className="flex w-full items-center justify-between rounded-card bg-bg-card p-4 shadow-card transition-colors hover:bg-bg-card-dim"
      >
        <span className="flex items-center gap-3">
          <span className="text-[18px]" aria-hidden>
            🗑️
          </span>
          <span className="text-[15px] font-semibold text-status-full">
            Delete account
          </span>
        </span>
        <span className="text-text-secondary">›</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete account"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        >
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              if (!submitting) setOpen(false);
            }}
            className="absolute inset-0 bg-black/40"
          />
          <div className="relative mx-auto w-full max-w-[375px] rounded-t-card bg-bg-base p-5 shadow-card sm:rounded-card">
            <h2 className="text-[18px] font-bold text-text-primary">
              {props.isLastAdmin ? "You're the only admin" : "Delete account?"}
            </h2>
            <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">
              {bodyCopy(props)}
            </p>

            {state.kind === "error" && (
              <p
                role="alert"
                className="mt-3 rounded-[8px] bg-bg-card-dim p-3 text-[13px] text-status-full"
              >
                {state.message}
              </p>
            )}

            <div className="mt-5 flex flex-col gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => void onConfirm()}
                className="h-11 rounded-card bg-status-full px-4 text-[15px] font-semibold text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Deleting…" : "Delete account"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="h-11 rounded-card bg-bg-card px-4 text-[15px] font-semibold text-text-primary transition-colors hover:bg-bg-card-dim disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Pick the modal body text per spec personal.md §145–149. Branch priority:
 *   1. last-admin guard wins (blocking copy)
 *   2. captain-of-upcoming
 *   3. accepted-in-others'-upcoming
 *   4. nothing — generic "history" copy
 */
function bodyCopy(props: DeleteAccountModalProps): string {
  if (props.isLastAdmin) {
    return "You're the only admin. Promote another user to admin first, then you'll be able to delete this account.";
  }
  if (props.captainUpcomingCount > 0) {
    const noun =
      props.captainUpcomingCount === 1 ? "upcoming match" : "upcoming matches";
    return `You're the organizer of ${props.captainUpcomingCount} ${noun}. They will be cancelled and players will be notified. This can't be undone.`;
  }
  if (props.acceptedUpcomingCount > 0) {
    const noun =
      props.acceptedUpcomingCount === 1
        ? "upcoming match"
        : "upcoming matches";
    return `You're signed up for ${props.acceptedUpcomingCount} ${noun}. Your spots will be freed for others. This can't be undone.`;
  }
  return "Your profile and history will be permanently removed. This can't be undone.";
}
