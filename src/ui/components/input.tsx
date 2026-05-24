/**
 * MODULE: ui.components.input
 * PURPOSE: Single-line text input. Mirrors .input-text from match.html:
 *          42px height, 10px radius, 1px border, white bg, green focus ring
 *          (3px rgba green @ 10%). Pass `type` for variants (text / email /
 *          search). Specialized time-input + search-input are deferred until
 *          a feature actually needs them.
 * LAYER: ui
 * RELATED DOCS: docs/ARCHITECTURE.md §11; mockups/match.html .input-text.
 */
import * as React from "react";
import { cn } from "@/src/ui/lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "h-[42px] w-full rounded-[10px] border border-border bg-bg-card px-3 font-sans text-[14px] text-text-primary",
          "placeholder:text-text-muted",
          "focus:border-border-focus focus:outline-none focus:ring-[3px] focus:ring-green-dark/10",
          "disabled:cursor-not-allowed disabled:bg-bg-surface disabled:text-text-muted",
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";
