/**
 * MODULE: app.(public).games.day-picker
 * PURPOSE: 21-day horizontal day strip (sticky). Single-select; default is
 *          today. Writes the selection to the URL via `?date=YYYY-MM-DD`
 *          (router.replace), triggering a Server Component re-fetch. Shows
 *          a small `[← Today]` ghost when a non-today day is selected, and a
 *          grey label below the strip (`Today` / `Tomorrow` / `Thursday 21`
 *          / `DD MMM`).
 * LAYER: interfaces (client island)
 * DEPENDENCIES: next/navigation, src/ui/lib/cn
 * INVARIANTS:
 *   - One day is always selected — no all/any mode. Tapping the active day
 *     is a no-op (spec).
 *   - Past dates are never shown. Strip starts from `today` (the prop —
 *     computed on the server in Prague TZ so SSR/hydration agree).
 *   - URL writes use `router.replace`, not `push` — day-picker movement
 *     should not pollute browser history (spec: primary filter, no back-
 *     button breadcrumbs).
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games" → day picker.
 */
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { cn } from "@/src/ui/lib/cn";

export interface DayPickerProps {
  /** Currently-selected Prague date (YYYY-MM-DD). */
  readonly value: string;
  /** Today in Prague TZ (YYYY-MM-DD). */
  readonly today: string;
  /** 21 Prague dates starting at today (inclusive). */
  readonly horizon: readonly string[];
}

const weekdayShort = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
});
const weekdayLong = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "long",
});
const monthShort = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "short",
});

function parseDate(yyyyMmDd: string): Date {
  const [y, m, d] = yyyyMmDd.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function diffDays(a: string, b: string): number {
  return Math.round(
    (parseDate(b).getTime() - parseDate(a).getTime()) / 86_400_000,
  );
}

function labelFor(date: string, today: string): string {
  const d = diffDays(today, date);
  if (d === 0) return "Today";
  if (d === 1) return "Tomorrow";
  const dt = parseDate(date);
  if (d <= 7) return `${weekdayLong.format(dt)} ${dt.getUTCDate()}`;
  return `${dt.getUTCDate()} ${monthShort.format(dt)}`;
}

export function DayPicker(props: DayPickerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const stripRef = React.useRef<HTMLDivElement>(null);

  const selectDate = (date: string): void => {
    if (date === props.value) return;
    const next = new URLSearchParams(searchParams.toString());
    if (date === props.today) {
      next.delete("date");
    } else {
      next.set("date", date);
    }
    // Cursor is page-1 specific; reset on day change.
    next.delete("cursor");
    const qs = next.toString();
    router.replace(qs ? `/games?${qs}` : "/games", { scroll: false });
  };

  // On mount: scroll the selected cell into view so users don't lose it on
  // deep links to a date 10+ days out.
  React.useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const cell = strip.querySelector<HTMLElement>(
      `[data-date="${props.value}"]`,
    );
    if (cell) {
      cell.scrollIntoView({ block: "nearest", inline: "center" });
    }
  }, [props.value]);

  return (
    <div className="bg-bg-base">
      <div
        ref={stripRef}
        className="no-scrollbar flex gap-1.5 overflow-x-auto px-4 py-3"
      >
        {props.horizon.map((date) => {
          const isActive = date === props.value;
          const dt = parseDate(date);
          return (
            <button
              key={date}
              data-date={date}
              type="button"
              onClick={() => selectDate(date)}
              className={cn(
                "flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-[10px] text-text-primary",
                isActive
                  ? "border-[1.5px] border-green-dark bg-bg-card"
                  : "border-[1.5px] border-transparent",
              )}
            >
              <span
                className={cn(
                  "text-[11px] uppercase tracking-wide",
                  isActive ? "text-green-dark" : "text-text-secondary",
                )}
              >
                {weekdayShort.format(dt)}
              </span>
              <span className="text-[16px] font-semibold leading-tight">
                {dt.getUTCDate()}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between px-4 pb-3 text-[12px] text-text-secondary">
        <span>{labelFor(props.value, props.today)}</span>
        {props.value !== props.today && (
          <button
            type="button"
            onClick={() => selectDate(props.today)}
            className="text-[12px] font-semibold text-green-dark hover:underline"
          >
            ← Today
          </button>
        )}
      </div>
    </div>
  );
}
