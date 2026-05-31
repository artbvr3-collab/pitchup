/**
 * MODULE: app.users.id.user-header-menu
 * PURPOSE: The `[⋯]` menu on `/users/:id` — a single "Report player" item.
 *          Signed-in viewers open the report submission modal; guests are
 *          routed to `/login` (spec: guests SEE the item, tap → Sign-in).
 * LAYER: interfaces (client island)
 * DEPENDENCIES: src/ui/components/report-submission-modal
 * INVARIANTS:
 *   - Only mounted for ACTIVE, non-self profiles — the page self-redirects the
 *     owner to `/me` and renders the privacy sentinel (no menu) for banned /
 *     deleted targets (spec personal.md §305).
 *   - Guest tap → `/login?callbackUrl=/users/:id`; after sign-in the user lands
 *     back here and taps Report themselves (no auto-submit, spec global.md §138).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/users/:id" → `[⋯]`
 *   - docs/spec/pitchup-spec-global.md → "Visual differences for guests"
 */
"use client";

import { useEffect, useRef, useState } from "react";

import { ReportSubmissionModal } from "@/src/ui/components/report-submission-modal";

export interface UserHeaderMenuProps {
  readonly userId: string;
  readonly signedIn: boolean;
}

export function UserHeaderMenu({ userId, signedIn }: UserHeaderMenuProps) {
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function onReportClick() {
    setOpen(false);
    if (!signedIn) {
      window.location.href = `/login?callbackUrl=${encodeURIComponent(
        `/users/${userId}`,
      )}`;
      return;
    }
    setReportOpen(true);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="More"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-9 items-center justify-center rounded-full text-[20px] leading-none text-text-secondary hover:bg-bg-surface"
      >
        ⋯
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-bg-card shadow-lg">
          <button
            type="button"
            onClick={onReportClick}
            className="block w-full px-4 py-2.5 text-left text-[14px] text-destructive hover:bg-destructive-bg"
          >
            Report player
          </button>
        </div>
      )}

      <ReportSubmissionModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        type="player"
        targetId={userId}
      />
    </div>
  );
}
