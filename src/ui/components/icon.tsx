/**
 * MODULE: ui.components.icon
 * PURPOSE: App-wide icon component. Renders Solar (bold-duotone / linear)
 *          icons from a trimmed, offline subset — no network at runtime.
 *          This is the canonical icon primitive for expressive/pictorial
 *          icons (nav, content, hero). Bare utility glyphs (checkbox tick,
 *          stepper ±) may still use other sources.
 * LAYER: ui
 * DEPENDENCIES: @iconify/react, ../lib/solar-icons.json (generated subset)
 * INVARIANTS:
 *   - `name` is a Solar icon slug WITHOUT the `solar:` prefix
 *     (e.g. "calendar-bold-duotone"). It must exist in solar-icons.json —
 *     regenerate that file (see its header) when adding a new icon.
 *   - Duotone tones derive from `color`/currentColor automatically: the
 *     secondary layer is the same hue at reduced opacity.
 * RELATED DOCS: project memory → design-system (Solar adoption).
 */
"use client";

import { addCollection, Icon as IconifyIcon } from "@iconify/react";

import solarSubset from "../lib/solar-icons.json";

// Register the trimmed Solar set once on the client (and during SSR of this
// client module, so the SVG is present in the first paint — no flash).
addCollection(solarSubset as Parameters<typeof addCollection>[0]);

export interface IconProps {
  /** Solar icon slug without the `solar:` prefix, e.g. "map-point-wave-bold-duotone". */
  readonly name: string;
  readonly size?: number;
  readonly className?: string;
  readonly style?: React.CSSProperties;
  readonly "aria-hidden"?: boolean;
}

export function Icon({ name, size = 24, className, style, ...rest }: IconProps) {
  return (
    <IconifyIcon
      icon={`solar:${name}`}
      width={size}
      height={size}
      className={className}
      style={style}
      {...rest}
    />
  );
}
