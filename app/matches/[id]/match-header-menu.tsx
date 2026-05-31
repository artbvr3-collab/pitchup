/**
 * MODULE: app.matches.id.match-header-menu
 * PURPOSE: The `[⋯]` top-right menu on `/matches/:id` — Share (everyone) +
 *          Report match (signed-in non-captains only). Mirrors spec match.md
 *          §485: "For guests and the captain of this match — Share only".
 * LAYER: interfaces (client island)
 * DEPENDENCIES: src/ui/components/report-submission-modal
 * INVARIANTS:
 *   - `canReport` is computed by the page (`viewerId !== null && role !==
 *     'captain'`). Guests / captain never see the Report item — they get Share
 *     only. Share is a public link, no auth needed.
 *   - Report opens the shared submission modal; the route re-checks `requireAuth`.
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "/matches/:id" → `⋯` dropdown.
 */
"use client";

import { useEffect, useRef, useState } from "react";

import { ReportSubmissionModal } from "@/src/ui/components/report-submission-modal";

export interface MatchHeaderMenuProps {
  readonly matchId: string;
  readonly canReport: boolean;
}

export function MatchHeaderMenu({ matchId, canReport }: MatchHeaderMenuProps) {
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

  async function share() {
    setOpen(false);
    const url = window.location.href;
    const nav = navigator as Navigator & {
      share?: (data: { url: string; title?: string }) => Promise<void>;
    };
    if (typeof nav.share === "function") {
      try {
        await nav.share({ url, title: "PITCHUP match" });
      } catch {
        // user cancelled the native share sheet — ignore
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      window.alert("Link copied");
    } catch {
      window.alert(url);
    }
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
            onClick={share}
            className="block w-full px-4 py-2.5 text-left text-[14px] text-text-primary hover:bg-bg-surface"
          >
            Share
          </button>
          {canReport && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setReportOpen(true);
              }}
              className="block w-full border-t border-border px-4 py-2.5 text-left text-[14px] text-destructive hover:bg-destructive-bg"
            >
              Report match
            </button>
          )}
        </div>
      )}

      <ReportSubmissionModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        type="match"
        targetId={matchId}
      />
    </div>
  );
}
