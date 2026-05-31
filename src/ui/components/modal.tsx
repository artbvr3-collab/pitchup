/**
 * MODULE: ui.components.modal
 * PURPOSE: Centered modal-dialog primitive — the counterpart to the bottom
 *          `Sheet`. Used for confirmation dialogs (useConfirm) and the
 *          Leave-with-reason flow. Owns the same cross-cutting mechanics as
 *          Sheet (backdrop click + Esc to close, body scroll-lock restoring the
 *          prior overflow) but centers a compact card instead of bottom-aligning.
 * LAYER: ui (client)
 * DEPENDENCIES: react, src/ui/lib/cn
 * CONSUMED BY: src/ui/components/confirm.tsx, src/ui/components/leave-match-modal.tsx
 * INVARIANTS:
 *   - Controlled: renders nothing when `open === false`.
 *   - Scroll-lock restores the PRIOR `document.body.style.overflow` on close —
 *     mirrors Sheet so a modal opened over a sheet doesn't clobber it.
 *   - Esc and backdrop click both call `onClose`. Focus-trap is intentionally
 *     deferred (same scope decision as Sheet).
 * RELATED DOCS: docs/ARCHITECTURE.md §11; src/ui/components/sheet.tsx (sibling).
 */
"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/src/ui/lib/cn";

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** Accessible label for the dialog. */
  readonly ariaLabel?: string;
  /** Extra classes merged onto the card element. */
  readonly className?: string;
}

export function Modal({
  open,
  onClose,
  children,
  ariaLabel,
  className,
}: ModalProps) {
  // Keep onClose in a ref so an unstable inline callback doesn't re-run the
  // scroll-lock/Esc effect on every parent render (same pattern as Sheet).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center p-6"
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
          "relative w-full max-w-[340px] rounded-[16px] bg-bg-base p-5 shadow-card",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
