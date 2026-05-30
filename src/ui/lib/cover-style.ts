/**
 * MODULE: ui.lib.cover-style
 * PURPOSE: Visual definition of the venue-cover palette — maps each cover slug
 *          (`COVER_IDS` in match_lifecycle/domain/covers) to a gradient + icon.
 *          Used by the `/admin/venues` cover picker (swatches + preview). The
 *          slugs are owned by the domain; this is the rendering layer.
 * LAYER: ui (presentation)
 * DEPENDENCIES: @/src/match_lifecycle/domain/covers (CoverId, COVER_IDS)
 * CONSUMED BY: app/admin/venues/admin-venues-table.tsx (cover picker)
 * INVARIANTS:
 *   - `COVER_STYLES` is `Record<CoverId, CoverStyle>` — adding a slug to
 *     `COVER_IDS` without a style here is a compile error (exhaustiveness).
 *   - This is the canonical home for the decorative cover gradients — a
 *     palette of its own (like `src/ui/tokens.ts` for the brand). Cover hex
 *     values live ONLY here; do not inline them elsewhere.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md → "Cover venue".
 */
import { type CoverId } from "@/src/match_lifecycle/domain/covers";

export interface CoverStyle {
  /** Top-left gradient stop. */
  readonly from: string;
  /** Bottom-right gradient stop. */
  readonly to: string;
  /** Decorative emoji icon overlaid on the gradient. */
  readonly icon: string;
}

export const COVER_STYLES: Record<CoverId, CoverStyle> = {
  "cover-001": { from: "#1B4332", to: "#2D6A4F", icon: "⚽" },
  "cover-002": { from: "#1D3557", to: "#457B9D", icon: "🥅" },
  "cover-003": { from: "#3A0CA3", to: "#7209B7", icon: "🏟️" },
  "cover-004": { from: "#264653", to: "#2A9D8F", icon: "🏆" },
  "cover-005": { from: "#6A040F", to: "#D00000", icon: "🔥" },
  "cover-006": { from: "#283618", to: "#606C38", icon: "🌱" },
  "cover-007": { from: "#03045E", to: "#0077B6", icon: "🌊" },
  "cover-008": { from: "#7F5539", to: "#B08968", icon: "🥾" },
  "cover-009": { from: "#480CA8", to: "#4361EE", icon: "⭐" },
  "cover-010": { from: "#9D0208", to: "#E85D04", icon: "🎯" },
  "cover-011": { from: "#212529", to: "#495057", icon: "🌙" },
  "cover-012": { from: "#005F73", to: "#0A9396", icon: "💧" },
};

/** Inline `background` string for a cover gradient. */
export function coverBackground(coverId: string): string {
  const style = COVER_STYLES[coverId as CoverId] ?? COVER_STYLES["cover-001"];
  return `linear-gradient(135deg, ${style.from}, ${style.to})`;
}

/** The decorative icon for a cover (falls back to ⚽ for unknown slugs). */
export function coverIcon(coverId: string): string {
  return (COVER_STYLES[coverId as CoverId] ?? COVER_STYLES["cover-001"]).icon;
}
