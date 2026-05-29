/**
 * MODULE: ui.components.sheet
 * PURPOSE: Shared hand-rolled bottom-sheet primitive. Extracted in Layer 7
 *          (the third sheet use case — Updates panel — after Discover's
 *          MoreFiltersSheet and the match CaptainSheet). Owns the cross-cutting
 *          mechanics every sheet needs: backdrop click + Esc to close, body
 *          scroll-lock (restoring the previous overflow value), bottom-aligned
 *          375px panel with a rounded top. Content is the caller's concern.
 * LAYER: ui (client)
 * DEPENDENCIES: react, src/ui/lib/cn
 * CONSUMED BY: app/updates-panel.tsx, app/(public)/games/more-filters-sheet.tsx,
 *              app/matches/[id]/captain-sheet.tsx
 * INVARIANTS:
 *   - Controlled: renders nothing when `open === false`. The caller owns the
 *     open flag (and may also gate mounting; both patterns work).
 *   - Scroll-lock restores the PRIOR `document.body.style.overflow` on close —
 *     not a hard-coded `""` — so nested/again-opened sheets don't clobber it.
 *   - Esc and backdrop click both call `onClose`. Focus-trap is intentionally
 *     deferred (same scope decision as the original hand-rolled sheets).
 * RELATED DOCS: docs/ARCHITECTURE.md §11, AGENTS.md (sheet-extraction gotcha).
 */
"use client";

import { useEffect } from "react";

import { cn } from "@/src/ui/lib/cn";

export interface SheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  /** Accessible label for the dialog (e.g. "Updates", "Manage match"). */
  readonly ariaLabel?: string;
  /** Extra classes merged onto the panel element. */
  readonly className?: string;
}

export function Sheet({
  open,
  onClose,
  children,
  ariaLabel,
  className,
}: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative mx-auto flex max-h-[85vh] w-full max-w-[375px] flex-col rounded-t-[20px] bg-bg-base shadow-card",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
