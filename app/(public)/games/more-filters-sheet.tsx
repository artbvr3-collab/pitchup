/**
 * MODULE: app.(public).games.more-filters-sheet
 * PURPOSE: "Game filters" bottom-sheet (the `[⚙]` icon target). Renders six
 *          sections — Distance, Time of day, Game size, Spots left, Price,
 *          Field status — as draft state that only commits to the URL on
 *          `[Apply filters]`. Close-without-apply discards draft (spec).
 * LAYER: interfaces (client island)
 * DEPENDENCIES: next/navigation, src/ui/components/*, ./use-saved-location,
 *               ../discover-types (re-exported via discover-shell)
 * INVARIANTS:
 *   - Draft state is reseeded from applied state every time the sheet opens
 *     (spec: "on re-opening — fields show the currently applied state, not
 *     the last draft").
 *   - `[Apply filters]` disabled when draft equals applied (tooltip "Nothing
 *     to apply").
 *   - `[Reset]` clears draft to defaults but does not close the sheet or
 *     auto-commit.
 *   - Distance section shows `[Set location]` CTA when no saved location is
 *     present; the radio is rendered otherwise. Both states write the same
 *     `?distance=` URL on Apply — SSR drops it when location is missing.
 *   - On Apply: removes `cursor` from URL — filter changes invalidate prior
 *     pages.
 *   - Body scroll is locked while the sheet is open.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games" → "More filters
 *               bottom-sheet" and "Apply / Reset behavior".
 */
"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

import { Button } from "@/src/ui/components/button";
import { Chip } from "@/src/ui/components/chip";
import { Sheet } from "@/src/ui/components/sheet";
import { cn } from "@/src/ui/lib/cn";

import {
  useSavedLocation,
  type SavedLocationState,
} from "./use-saved-location";

type DistanceKm = 1 | 3 | 5 | 10;
type TimeOfDay = "morning" | "afternoon" | "evening";
type SpotsBucket = "1" | "2-3" | "4+";

export interface SheetAppliedState {
  readonly distanceKm: DistanceKm | null;
  readonly timeOfDay: readonly TimeOfDay[];
  readonly gameSize: readonly number[];
  readonly spotsLeft: SpotsBucket | null;
  readonly freeOnly: boolean;
  readonly fieldBookedOnly: boolean;
}

export interface MoreFiltersSheetProps {
  readonly open: boolean;
  readonly applied: SheetAppliedState;
  readonly onClose: () => void;
}

const DISTANCE_OPTIONS: readonly (DistanceKm | null)[] = [null, 1, 3, 5, 10];
const TIME_OPTIONS: readonly TimeOfDay[] = ["morning", "afternoon", "evening"];
const TIME_LABEL: Record<TimeOfDay, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};
const GAME_SIZE_OPTIONS: readonly number[] = [4, 5, 6, 7, 8, 9, 10, 11];
const SPOTS_OPTIONS: readonly (SpotsBucket | null)[] = [
  null,
  "1",
  "2-3",
  "4+",
];
const SPOTS_LABEL: Record<SpotsBucket, string> = {
  "1": "1 spot",
  "2-3": "2–3 spots",
  "4+": "4+ spots",
};

const EMPTY_STATE: SheetAppliedState = {
  distanceKm: null,
  timeOfDay: [],
  gameSize: [],
  spotsLeft: null,
  freeOnly: false,
  fieldBookedOnly: false,
};

function arraysEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function statesEqual(a: SheetAppliedState, b: SheetAppliedState): boolean {
  return (
    a.distanceKm === b.distanceKm &&
    arraysEqual(a.timeOfDay, b.timeOfDay) &&
    arraysEqual(a.gameSize, b.gameSize) &&
    a.spotsLeft === b.spotsLeft &&
    a.freeOnly === b.freeOnly &&
    a.fieldBookedOnly === b.fieldBookedOnly
  );
}

export function MoreFiltersSheet(props: MoreFiltersSheetProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const savedLocation = useSavedLocation();

  const [draft, setDraft] = React.useState<SheetAppliedState>(props.applied);

  // Reseed draft from applied every time the sheet opens.
  React.useEffect(() => {
    if (props.open) setDraft(props.applied);
  }, [props.open, props.applied]);

  const isDirty = !statesEqual(draft, props.applied);

  const apply = (): void => {
    const next = new URLSearchParams(searchParams.toString());
    setOrDelete(next, "distance", draft.distanceKm?.toString() ?? null);
    setOrDelete(
      next,
      "time",
      draft.timeOfDay.length ? draft.timeOfDay.join(",") : null,
    );
    setOrDelete(
      next,
      "size",
      draft.gameSize.length ? draft.gameSize.join(",") : null,
    );
    setOrDelete(next, "spots", draft.spotsLeft);
    setOrDelete(next, "free", draft.freeOnly ? "1" : null);
    setOrDelete(next, "booked", draft.fieldBookedOnly ? "1" : null);
    next.delete("cursor"); // filter change → page-1 reset
    const qs = next.toString();
    router.replace(qs ? `/games?${qs}` : "/games", { scroll: false });
    props.onClose();
  };

  const reset = (): void => setDraft(EMPTY_STATE);

  return (
    <Sheet open={props.open} onClose={props.onClose} ariaLabel="Game filters">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <button
            type="button"
            aria-label="Close"
            onClick={props.onClose}
            className="text-[18px] text-text-secondary"
          >
            ✕
          </button>
          <h2 className="text-[15px] font-semibold text-text-primary">
            Game filters
          </h2>
          <span className="w-4" />
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5">
          <DistanceSection
            value={draft.distanceKm}
            onChange={(v) => setDraft({ ...draft, distanceKm: v })}
            savedLocation={savedLocation}
            onSetLocationClick={props.onClose}
          />
          <TimeOfDaySection
            value={draft.timeOfDay}
            onChange={(v) => setDraft({ ...draft, timeOfDay: v })}
          />
          <GameSizeSection
            value={draft.gameSize}
            onChange={(v) => setDraft({ ...draft, gameSize: v })}
          />
          <SpotsLeftSection
            value={draft.spotsLeft}
            onChange={(v) => setDraft({ ...draft, spotsLeft: v })}
          />
          <ToggleSection
            icon="🆓"
            label="Free only"
            value={draft.freeOnly}
            onChange={(v) => setDraft({ ...draft, freeOnly: v })}
          />
          <ToggleSection
            icon="✓"
            label="Field booked only"
            value={draft.fieldBookedOnly}
            onChange={(v) => setDraft({ ...draft, fieldBookedOnly: v })}
          />
        </div>

        <footer className="flex items-center gap-3 border-t border-border bg-bg-card px-4 py-3">
          <Button
            variant="ghost"
            type="button"
            onClick={reset}
            className="!w-auto px-4"
          >
            Reset
          </Button>
          <div className="flex-1">
            <Button
              variant={isDirty ? "primary" : "disabled"}
              type="button"
              onClick={apply}
              disabled={!isDirty}
              title={isDirty ? undefined : "Nothing to apply"}
            >
              Apply filters
            </Button>
          </div>
        </footer>
    </Sheet>
  );
}

function setOrDelete(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value === null) params.delete(key);
  else params.set(key, value);
}

function SectionHeading(props: { icon: string; label: string }) {
  return (
    <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-secondary">
      <span className="mr-1">{props.icon}</span>
      {props.label}
    </h3>
  );
}

function DistanceSection(props: {
  value: DistanceKm | null;
  onChange: (v: DistanceKm | null) => void;
  savedLocation: SavedLocationState;
  onSetLocationClick: () => void;
}) {
  const locationKnown = props.savedLocation !== undefined;
  const locationSet = props.savedLocation !== null && props.savedLocation !== undefined;
  return (
    <section>
      <SectionHeading icon="📍" label="Distance" />
      {!locationKnown ? (
        // Hydration in flight — render a stable placeholder.
        <div className="h-9 w-32 animate-pulse rounded-chip bg-bg-card-dim" />
      ) : locationSet ? (
        <div className="flex flex-wrap gap-1.5">
          {DISTANCE_OPTIONS.map((opt) => (
            <Chip
              key={String(opt)}
              active={props.value === opt}
              onClick={() => props.onChange(opt)}
            >
              {opt === null ? "Any" : `${opt} km`}
            </Chip>
          ))}
        </div>
      ) : (
        <Link
          href="/map?pickLocation=true"
          onClick={props.onSetLocationClick}
          className="inline-flex h-9 items-center justify-center rounded-chip border border-border-strong bg-bg-card px-4 text-[13px] font-semibold text-green-dark"
        >
          Set location
        </Link>
      )}
    </section>
  );
}

function TimeOfDaySection(props: {
  value: readonly TimeOfDay[];
  onChange: (v: readonly TimeOfDay[]) => void;
}) {
  const toggle = (t: TimeOfDay): void => {
    props.onChange(
      props.value.includes(t)
        ? props.value.filter((x) => x !== t)
        : [...props.value, t],
    );
  };
  return (
    <section>
      <SectionHeading icon="🕐" label="Time of day" />
      <div className="flex flex-wrap gap-1.5">
        {TIME_OPTIONS.map((t) => (
          <Chip key={t} active={props.value.includes(t)} onClick={() => toggle(t)}>
            {TIME_LABEL[t]}
          </Chip>
        ))}
      </div>
    </section>
  );
}

function GameSizeSection(props: {
  value: readonly number[];
  onChange: (v: readonly number[]) => void;
}) {
  const toggle = (n: number): void => {
    props.onChange(
      props.value.includes(n)
        ? props.value.filter((x) => x !== n)
        : [...props.value, n].sort((a, b) => a - b),
    );
  };
  return (
    <section>
      <SectionHeading icon="⚽" label="Game size" />
      <div className="flex flex-wrap gap-1.5">
        {GAME_SIZE_OPTIONS.map((n) => (
          <Chip key={n} active={props.value.includes(n)} onClick={() => toggle(n)}>
            {n} a side
          </Chip>
        ))}
      </div>
    </section>
  );
}

function SpotsLeftSection(props: {
  value: SpotsBucket | null;
  onChange: (v: SpotsBucket | null) => void;
}) {
  return (
    <section>
      <SectionHeading icon="⚡" label="Spots left" />
      <div className="flex flex-wrap gap-1.5">
        {SPOTS_OPTIONS.map((opt) => (
          <Chip
            key={String(opt)}
            active={props.value === opt}
            onClick={() => props.onChange(opt)}
          >
            {opt === null ? "Any" : SPOTS_LABEL[opt]}
          </Chip>
        ))}
      </div>
    </section>
  );
}

function ToggleSection(props: {
  icon: string;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <section>
      <label className="flex items-center justify-between gap-3">
        <span className="text-[14px] font-semibold text-text-primary">
          <span className="mr-1">{props.icon}</span>
          {props.label}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={props.value}
          onClick={() => props.onChange(!props.value)}
          className={cn(
            "relative h-6 w-11 rounded-full border transition-colors",
            props.value
              ? "border-green-dark bg-green-dark"
              : "border-border-strong bg-bg-card",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-bg-card shadow-card transition-transform",
              props.value
                ? "translate-x-[1.25rem] bg-text-inverted"
                : "translate-x-0.5",
            )}
          />
        </button>
      </label>
    </section>
  );
}
