/**
 * MODULE: ui.tokens
 * PURPOSE: TypeScript mirror of the canonical CSS design tokens declared in
 *          app/globals.css. Provides typed autocomplete when a component needs
 *          to reference a token value programmatically (e.g. inline styles for
 *          a gradient that can't be expressed via Tailwind classes).
 * LAYER: ui
 * DEPENDENCIES: none (pure data).
 * CONSUMED BY: src/ui/components/* when class-based styling is insufficient;
 *              docs / Storybook in future.
 * INVARIANTS:
 *   - The single source of truth for these values is the CSS variables in
 *     app/globals.css (which were extracted from mockups/match.html). If a
 *     value here drifts, the CSS wins. Update both atomically.
 *   - Never inline a raw hex in feature code — import from here or use a
 *     Tailwind class wired in tailwind.config.ts.
 * RELATED DOCS: docs/ARCHITECTURE.md §11, mockups/match.html token header.
 */

export const tokens = {
  // Surfaces
  bgBase: "#F5F0E8",
  bgSurface: "#EDE8DC",
  bgCard: "#FFFFFF",
  bgCardDim: "#F9F7F4",

  // Primary accent (dark green)
  greenDark: "#0E5C2F",
  greenMid: "#176B38",

  // Secondary accent (lime CTA)
  lime: "#C5E63C",
  limeDark: "#A8C82E",
  limeText: "#2D3A00",

  // Text
  textPrimary: "#1A1A1A",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",
  textInverted: "#FFFFFF",

  // Slot / status
  statusOpen: "#0E5C2F",
  statusAlmost: "#D97706",
  statusFull: "#DC2626",
  statusInProgress: "#6B7280",

  // Structure
  border: "#E0DAD0",
  borderStrong: "#C7C0B3",
  borderFocus: "#0E5C2F",
  destructive: "#DC2626",
  destructiveBg: "#FEE2E2",

  // Radii
  radiusCard: "16px",
  radiusBtn: "12px",
  radiusChip: "9999px",
  radiusBadge: "6px",

  // Shadows
  shadowCard: "0 1px 3px rgba(0,0,0,0.07), 0 1px 2px rgba(0,0,0,0.05)",
  shadowBtn: "0 2px 8px rgba(14,92,47,0.25)",
  shadowBtnLime: "0 2px 8px rgba(197,230,60,0.3)",
} as const;

export type Token = keyof typeof tokens;
