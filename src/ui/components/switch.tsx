/**
 * MODULE: ui.components.switch
 * PURPOSE: Toggle switch on Radix primitive. Mirrors .switch from
 *          create-match.html: 46×26 track, 20px knob, border-strong off-state,
 *          green-dark on-state, 150ms transition.
 * LAYER: ui
 * DEPENDENCIES: @radix-ui/react-switch.
 * CONSUMED BY: /matches/new (e.g. field-booked, studs-allowed).
 * RELATED DOCS: docs/ARCHITECTURE.md §11; mockups/create-match.html .switch.
 */
"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";
import { cn } from "@/src/ui/lib/cn";

export type SwitchProps = React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>;

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  SwitchProps
>(({ className, ...props }, ref) => {
  return (
    <SwitchPrimitive.Root
      ref={ref}
      className={cn(
        "relative inline-flex h-[26px] w-[46px] shrink-0 cursor-pointer items-center rounded-chip transition-colors",
        "bg-border-strong data-[state=checked]:bg-green-dark",
        "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-green-dark/20",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-5 w-5 translate-x-[3px] rounded-full bg-white shadow-sm transition-transform",
          "data-[state=checked]:translate-x-[23px]",
        )}
      />
    </SwitchPrimitive.Root>
  );
});
Switch.displayName = "Switch";
