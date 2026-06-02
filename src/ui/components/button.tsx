/**
 * MODULE: ui.components.button
 * PURPOSE: Primary action button. Variants mirror the .btn-* classes in
 *          mockups/match.html: primary (dark green), lime (CTA), ghost (card
 *          outline), destructive-ghost (red outline), publish (taller, used as
 *          wizard final step). Renders as <button> or as the child element via
 *          asChild (Radix Slot pattern).
 * LAYER: ui
 * DEPENDENCIES: @radix-ui/react-slot, class-variance-authority.
 * CONSUMED BY: feature screens from Layer 1 onwards.
 * RELATED DOCS: docs/ARCHITECTURE.md §11; mockups/match.html .btn rules.
 */
"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/src/ui/lib/cn";

const buttonVariants = cva(
  "inline-flex w-full items-center justify-center gap-1.5 font-sans font-semibold transition-opacity disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        primary:
          "bg-gradient-green text-text-inverted shadow-btn hover:opacity-95",
        lime: "bg-gradient-lime text-lime-text shadow-btn-lime hover:opacity-95",
        ghost:
          "border-[1.5px] border-border bg-bg-card text-text-primary hover:bg-bg-surface",
        "destructive-ghost":
          "border-[1.5px] border-[#FECACA] bg-transparent text-destructive hover:bg-destructive-bg",
        destructive:
          "bg-destructive text-text-inverted shadow-btn hover:opacity-90",
        disabled: "bg-bg-surface text-text-muted",
      },
      size: {
        md: "h-12 rounded-btn text-[15px]",
        lg: "h-[50px] rounded-btn text-[15px] font-bold",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
