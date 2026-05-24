/**
 * MODULE: ui.components.chip
 * PURPOSE: Pill-shaped selectable tag. Mirrors .chip from match.html:
 *          inactive (white bg + strong border + secondary text),
 *          active (green-dark bg + inverted text),
 *          custom (dashed border, for "Custom" / "Other" entries).
 *          Renders as <button> so it's keyboard-focusable.
 * LAYER: ui
 * CONSUMED BY: filters in /games, day/duration pickers in /matches/new.
 * RELATED DOCS: docs/ARCHITECTURE.md §11; mockups/match.html .chip rules.
 */
import * as React from "react";
import { cn } from "@/src/ui/lib/cn";

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  custom?: boolean;
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, active = false, custom = false, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        aria-pressed={active}
        className={cn(
          "inline-flex h-9 items-center justify-center rounded-chip px-3.5 text-[13px] font-semibold transition-colors",
          "border border-border-strong",
          custom && "border-dashed text-text-secondary",
          !active && !custom && "bg-bg-card text-text-secondary hover:bg-bg-surface",
          active && "border-green-dark bg-green-dark text-text-inverted",
          className,
        )}
        {...props}
      />
    );
  },
);
Chip.displayName = "Chip";
