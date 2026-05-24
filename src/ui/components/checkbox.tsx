/**
 * MODULE: ui.components.checkbox
 * PURPOSE: Checkbox on Radix primitive. Mirrors .checkbox from
 *          create-match.html: 22×22, 6px radius, 1.5px border-strong border,
 *          white bg when unchecked, green-dark bg + inverted check icon when
 *          checked.
 * LAYER: ui
 * DEPENDENCIES: @radix-ui/react-checkbox, lucide-react.
 * RELATED DOCS: docs/ARCHITECTURE.md §11; mockups/create-match.html .checkbox.
 */
"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import * as React from "react";
import { cn } from "@/src/ui/lib/cn";

export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>;

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  CheckboxProps
>(({ className, ...props }, ref) => {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-badge border-[1.5px] border-border-strong bg-bg-card transition-colors",
        "data-[state=checked]:border-green-dark data-[state=checked]:bg-green-dark data-[state=checked]:text-text-inverted",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-green-dark/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check size={14} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = "Checkbox";
