/**
 * MODULE: ui.components.card
 * PURPOSE: Surface container with white background, card shadow, and the
 *          16px / 14px paddings from match.html (.preview-card, .player-chip).
 *          Two sizes: default (16px padding, radius-card) for content cards;
 *          compact (8px v / 12px h, radius-btn) for player-chip-style rows.
 * LAYER: ui
 * RELATED DOCS: docs/ARCHITECTURE.md §11; mockups/match.html .preview-card.
 */
import * as React from "react";
import { cn } from "@/src/ui/lib/cn";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "compact";
}

export function Card({ className, variant = "default", ...props }: CardProps) {
  return (
    <div
      className={cn(
        "bg-bg-card shadow-card",
        variant === "default" && "rounded-card p-4",
        variant === "compact" && "rounded-btn px-3 py-2",
        className,
      )}
      {...props}
    />
  );
}
