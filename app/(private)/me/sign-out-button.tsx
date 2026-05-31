/**
 * MODULE: app.(private).me.sign-out-button
 * PURPOSE: Client wrapper for the /me Sign-out row. Clears per-device,
 *          per-match shuffle caches (`pitchup:teams:*`) from localStorage
 *          BEFORE invoking the existing `signOutAction` Server Action — the
 *          shared-device guard from spec match.md §349 (the next signed-in
 *          captain must not see the previous one's team cache). A Server
 *          Action can't touch localStorage, so the clear has to happen
 *          client-side here.
 * LAYER: interfaces (client island)
 * DEPENDENCIES: ./actions (signOutAction), src/ui/lib/team-shuffle
 * INVARIANTS:
 *   - Cache clear is best-effort and always followed by the Server Action,
 *     even if clearing throws (the lib swallows its own errors).
 *   - Visual parity with the previous Server-Action form button — same
 *     markup, so /me looks identical.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Shuffle teams" → cleanup
 */
"use client";

import { clearTeamShuffleCaches } from "@/src/ui/lib/team-shuffle";

import { signOutAction } from "./actions";

export function SignOutButton() {
  const onClick = async () => {
    clearTeamShuffleCaches();
    await signOutAction();
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-card bg-bg-card p-4 shadow-card transition-colors hover:bg-bg-card-dim"
    >
      <span className="flex items-center gap-3">
        <span className="text-[18px]" aria-hidden>
          ↩
        </span>
        <span className="text-[15px] font-semibold text-text-primary">
          Sign out
        </span>
      </span>
      <span className="text-text-secondary">›</span>
    </button>
  );
}
