/**
 * MODULE: ui.components.stepper
 * PURPOSE: Numeric +/− stepper. Mirrors .stepper from create-match.html:
 *          44px square buttons with green chevrons, 56px-wide centered value,
 *          1px border, 12px radius, white bg. Controlled component — parent
 *          owns the value and clamps to [min, max].
 * LAYER: ui
 * CONSUMED BY: /matches/new wizard (guest count, total spots) — Layer 3.
 * RELATED DOCS: docs/ARCHITECTURE.md §11; mockups/create-match.html .stepper.
 */
"use client";

import * as React from "react";
import { Minus, Plus } from "@phosphor-icons/react";
import { cn } from "@/src/ui/lib/cn";

export interface StepperProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel?: string;
  className?: string;
}

export function Stepper({
  value,
  onChange,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  ariaLabel,
  className,
}: StepperProps) {
  const canDec = value > min;
  const canInc = value < max;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center overflow-hidden rounded-btn border border-border bg-bg-card",
        className,
      )}
    >
      <button
        type="button"
        disabled={!canDec}
        aria-label="Decrement"
        onClick={() => onChange(Math.max(min, value - step))}
        className={cn(
          "flex h-11 w-11 items-center justify-center text-green-dark hover:bg-bg-surface",
          "disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent",
        )}
      >
        <Minus size={18} weight="bold" />
      </button>
      <span
        aria-live="polite"
        className="min-w-14 text-center text-[17px] font-bold text-text-primary"
      >
        {value}
      </span>
      <button
        type="button"
        disabled={!canInc}
        aria-label="Increment"
        onClick={() => onChange(Math.min(max, value + step))}
        className={cn(
          "flex h-11 w-11 items-center justify-center text-green-dark hover:bg-bg-surface",
          "disabled:cursor-not-allowed disabled:text-text-muted disabled:hover:bg-transparent",
        )}
      >
        <Plus size={18} weight="bold" />
      </button>
    </div>
  );
}
