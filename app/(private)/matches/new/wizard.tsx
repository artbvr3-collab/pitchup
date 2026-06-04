/**
 * MODULE: app.(private).matches.new.wizard
 * PURPOSE: 3-step Create-match wizard. Mirrors `mockups/create-match.html`
 *          one-to-one (calendar grid, time, duration chips, venue search /
 *          list; total stepper, crew chips, surface, studs toggle, field
 *          booked, price; description, preview, publish).
 * LAYER: interfaces (client island)
 * DEPENDENCIES: src/ui/components/*, src/match_lifecycle/application/list-
 *               venues-service (type only)
 * INVARIANTS:
 *   - Date picker offers `today_prague` through `today_prague + 20` inclusive
 *     (21-day horizon per spec).
 *   - When selected date = today, time min is `now + 30 min` (Prague). Future
 *     date — any time.
 *   - Total spots ∈ [8, 30], default 14.
 *   - Crew name trimmed before chipping; blank-after-trim ignored; max 30
 *     chars; duplicates allowed; chip input disabled when
 *     `1 + crew.length >= totalSpots`.
 *   - Surface chip set comes from the chosen venue; `studs` toggle hidden
 *     when surface = hard.
 *   - All HTTP-only validation comes from the backend (see CreateMatchService);
 *     on `{ code, meta }` error this component routes the user back to the
 *     relevant step + shows toast.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/new"
 *   - mockups/create-match.html (visual anchor)
 */
"use client";

import { CaretLeft, CaretRight, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import * as React from "react";

import { Button } from "@/src/ui/components/button";
import { Checkbox } from "@/src/ui/components/checkbox";
import { Chip } from "@/src/ui/components/chip";
import { useConfirm } from "@/src/ui/components/confirm";
import { Input } from "@/src/ui/components/input";
import { Stepper } from "@/src/ui/components/stepper";
import { Switch } from "@/src/ui/components/switch";
import { cn } from "@/src/ui/lib/cn";
import { coverBackground } from "@/src/ui/lib/cover-style";

import type { VenueView } from "@/src/match_lifecycle/application/list-venues-service";

// ────────── constants ──────────
const HORIZON_DAYS = 20; // inclusive: today..today+20
const MIN_OFFSET_MIN = 30;
const MIN_TOTAL = 8;
const MAX_TOTAL = 30;
const DEFAULT_TOTAL = 14;
const MAX_CREW_NAME = 30;
const MAX_DESCRIPTION = 2000;

const PRAGUE_TZ = "Europe/Prague";
const DOW_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SHORT_MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const SHORT_DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ────────── Prague-aware date utilities (client-side, naive but pragmatic) ──────────

/** "YYYY-MM-DD" in Prague time for the given instant. */
function pragueDateString(instant: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: PRAGUE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(instant);
}

function pragueHourMinute(instant: Date): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: PRAGUE_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const lookup: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") lookup[p.type] = p.value;
  return { hour: Number(lookup.hour) % 24, minute: Number(lookup.minute) };
}

/** Parses "YYYY-MM-DD" + "HH:MM" Prague wall-clock into a UTC Date. */
function pragueWallClockToUtc(dateYmd: string, timeHm: string): Date {
  // Two-pass guess: pretend the wall-clock is UTC, observe what Prague would
  // read, correct. Two iterations cover DST cleanly.
  const [y, mo, d] = dateYmd.split("-").map(Number) as [number, number, number];
  const [hh, mm] = timeHm.split(":").map(Number) as [number, number];
  let guess = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
  for (let i = 0; i < 3; i++) {
    const observedDate = pragueDateString(guess);
    const observed = pragueHourMinute(guess);
    if (
      observedDate === dateYmd &&
      observed.hour === hh &&
      observed.minute === mm
    ) {
      return guess;
    }
    // Correct guess by observed delta.
    const observedY = Number(observedDate.slice(0, 4));
    const observedMo = Number(observedDate.slice(5, 7));
    const observedD = Number(observedDate.slice(8, 10));
    const observedUtc = Date.UTC(
      observedY,
      observedMo - 1,
      observedD,
      observed.hour,
      observed.minute,
      0,
    );
    const targetUtc = Date.UTC(y, mo - 1, d, hh, mm, 0);
    guess = new Date(guess.getTime() + (targetUtc - observedUtc));
  }
  return guess;
}

function addPragueDaysYmd(dateYmd: string, days: number): string {
  const [y, m, d] = dateYmd.split("-").map(Number) as [number, number, number];
  const t = Date.UTC(y, m - 1, d + days);
  const next = new Date(t);
  const yyyy = String(next.getUTCFullYear()).padStart(4, "0");
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function ymdToParts(ymd: string): { year: number; month: number; day: number } {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
}

/** ISO weekday 0..6 where 0=Mon..6=Sun (matches mockup's grid header). */
function isoWeekday(ymd: string): number {
  const { year, month, day } = ymdToParts(ymd);
  const jsDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0=Sun..6=Sat
  return (jsDow + 6) % 7; // 0=Mon..6=Sun
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ────────── Shared state shape ──────────

type Surface = "grass" | "hard";

interface WizardState {
  step: 1 | 2 | 3;
  // step 1
  date: string; // YYYY-MM-DD Prague
  time: string; // HH:MM
  duration: number; // minutes
  venueId: string | null;
  venueSearch: string;
  // step 2
  totalSpots: number;
  crew: string[];
  surface: Surface | null;
  studsAllowed: boolean;
  fieldBooked: boolean;
  priceMode: "paid" | "free";
  priceText: string;
  // step 3
  description: string;
}

// ────────── Top-level component ──────────

export interface WizardProps {
  readonly venues: readonly VenueView[];
  readonly nowIso: string;
}

export function Wizard({ venues, nowIso }: WizardProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const initialNow = React.useMemo(() => new Date(nowIso), [nowIso]);
  const initialToday = React.useMemo(() => pragueDateString(initialNow), [initialNow]);

  const [state, setState] = React.useState<WizardState>(() => ({
    step: 1,
    date: initialToday,
    time: defaultInitialTime(initialNow, initialToday),
    duration: 90,
    venueId: null,
    venueSearch: "",
    totalSpots: DEFAULT_TOTAL,
    crew: [],
    surface: null,
    studsAllowed: true,
    fieldBooked: false,
    priceMode: "paid",
    priceText: "",
    description: "",
  }));

  const [toast, setToast] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const venueById = React.useMemo(
    () => new Map(venues.map((v) => [v.id, v])),
    [venues],
  );
  const selectedVenue = state.venueId ? venueById.get(state.venueId) ?? null : null;

  // When venue changes, default surface to the venue's first offering and
  // keep studs sensible (off for hard).
  React.useEffect(() => {
    if (!selectedVenue) return;
    setState((s) => {
      const surfaceStillValid =
        s.surface !== null && selectedVenue.surface.includes(s.surface);
      const nextSurface = surfaceStillValid ? s.surface! : selectedVenue.surface[0]!;
      const nextStuds = nextSurface === "hard" ? false : s.studsAllowed;
      if (nextSurface === s.surface && nextStuds === s.studsAllowed) return s;
      return { ...s, surface: nextSurface, studsAllowed: nextStuds };
    });
  }, [selectedVenue]);

  // ─── derived values ───
  const today = initialToday;
  const maxDate = addPragueDaysYmd(today, HORIZON_DAYS);

  const isToday = state.date === today;
  const minTimeForToday = React.useMemo(() => {
    if (!isToday) return null;
    const minInstant = new Date(initialNow.getTime() + MIN_OFFSET_MIN * 60_000);
    if (pragueDateString(minInstant) !== today) {
      // The 30-min window crosses midnight Prague → today's grid has no valid
      // start times. We still surface the input but it'll fail validation.
      return "23:59";
    }
    const { hour, minute } = pragueHourMinute(minInstant);
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }, [initialNow, isToday, today]);

  const startTimeUtc = React.useMemo(() => {
    if (!state.date || !state.time) return null;
    return pragueWallClockToUtc(state.date, state.time);
  }, [state.date, state.time]);

  const step1Valid =
    !!selectedVenue &&
    state.date >= today &&
    state.date <= maxDate &&
    /^\d{2}:\d{2}$/.test(state.time) &&
    (!minTimeForToday || state.time >= minTimeForToday) &&
    state.duration > 0 &&
    state.duration <= 240;

  const crewFilled = 1 + state.crew.length;
  const step2Valid =
    state.totalSpots >= MIN_TOTAL &&
    state.totalSpots <= MAX_TOTAL &&
    crewFilled <= state.totalSpots &&
    state.surface !== null &&
    (state.priceMode === "free" || (state.priceText.trim() !== "" && Number(state.priceText) >= 0));

  const isDirty =
    !!state.venueId ||
    state.crew.length > 0 ||
    state.description.trim().length > 0;

  // ─── handlers ───
  const onClose = async () => {
    if (isDirty) {
      const ok = await confirm({
        title: "Discard match?",
        body: "Your changes will be lost.",
        confirmLabel: "Discard",
        cancelLabel: "Keep editing",
        tone: "destructive",
      });
      if (!ok) return;
    }
    router.push("/my-matches");
  };

  const goBack = () => setState((s) => ({ ...s, step: clampStep(s.step - 1) }));
  const goNext = () => setState((s) => ({ ...s, step: clampStep(s.step + 1) }));

  const submit = async () => {
    if (submitting) return;
    if (!selectedVenue || !state.surface || !startTimeUtc) return;
    setSubmitting(true);
    setToast(null);
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venue_id: selectedVenue.id,
          start_time: startTimeUtc.toISOString(),
          duration: state.duration,
          total_spots: state.totalSpots,
          price: state.priceMode === "free" ? 0 : Math.max(0, Math.floor(Number(state.priceText) || 0)),
          surface: state.surface,
          studs_allowed: state.surface === "hard" ? false : state.studsAllowed,
          field_booked: state.fieldBooked,
          description: state.description.trim() === "" ? null : state.description.trim(),
          captain_crew: state.crew,
        }),
      });
      if (res.status === 201) {
        const body = (await res.json()) as { id: string };
        // Layer 5 will build /matches/:id. Until then, hop to /games where
        // the new match will appear in the discover list.
        router.push(`/games?created=${encodeURIComponent(body.id)}`);
        return;
      }
      const errBody = (await res.json().catch(() => ({}))) as {
        code?: string;
        meta?: Record<string, unknown>;
      };
      handleBackendError(errBody, setState, setToast);
    } catch {
      setToast("Couldn’t publish. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ─── render ───
  return (
    <main className="mx-auto flex min-h-dvh max-w-screen flex-col bg-bg-base">
      <Header onClose={onClose} />
      <Progress step={state.step} />

      <div className="flex flex-1 flex-col gap-5 px-5 pb-5 pt-2">
        {state.step === 1 && (
          <Step1
            state={state}
            today={today}
            maxDate={maxDate}
            minTimeForToday={minTimeForToday}
            venues={venues}
            setState={setState}
          />
        )}
        {state.step === 2 && selectedVenue && (
          <Step2
            state={state}
            venue={selectedVenue}
            setState={setState}
          />
        )}
        {state.step === 3 && selectedVenue && (
          <Step3
            state={state}
            venue={selectedVenue}
            setState={setState}
            submitting={submitting}
            onPublish={submit}
          />
        )}
      </div>

      <Footer
        step={state.step}
        canGoNext={
          (state.step === 1 && step1Valid) ||
          (state.step === 2 && step2Valid)
        }
        onBack={goBack}
        onNext={goNext}
        submitting={submitting}
      />

      {toast && (
        <div className="fixed bottom-20 left-1/2 z-30 -translate-x-1/2 rounded-btn bg-text-primary px-4 py-3 text-[13px] font-semibold text-text-inverted shadow-card">
          {toast}
        </div>
      )}
    </main>
  );
}

// ────────── Sub-components ──────────

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 pb-3 pt-4">
      <span className="text-[17px] font-bold tracking-tight">New match</span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-text-secondary hover:bg-bg-surface hover:text-text-primary"
      >
        <X size={18} strokeWidth={2.5} />
      </button>
    </div>
  );
}

function Progress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pb-4">
      <div className="flex items-center gap-1.5">
        {[1, 2, 3].map((n) => (
          <React.Fragment key={n}>
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full bg-border-strong",
                step === n && "bg-green-dark",
                step > n && "bg-green-dark/40",
              )}
            />
            {n < 3 && (
              <span
                className={cn(
                  "h-0.5 w-7 rounded-sm bg-border-strong",
                  step > n && "bg-green-dark/40",
                )}
              />
            )}
          </React.Fragment>
        ))}
      </div>
      <span className="text-[12px] font-semibold text-text-secondary">
        Step {step} / 3
      </span>
    </div>
  );
}

function Footer({
  step,
  canGoNext,
  onBack,
  onNext,
  submitting,
}: {
  step: 1 | 2 | 3;
  canGoNext: boolean;
  onBack: () => void;
  onNext: () => void;
  submitting: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2.5 border-t border-border bg-bg-base px-5 py-4">
      <Button
        type="button"
        variant="ghost"
        size="md"
        className="w-auto px-4 text-[14px]"
        disabled={step === 1 || submitting}
        onClick={onBack}
      >
        ← Back
      </Button>
      {step < 3 ? (
        <Button
          type="button"
          variant="primary"
          size="md"
          className="w-auto px-5 text-[14px]"
          disabled={!canGoNext}
          onClick={onNext}
        >
          Next →
        </Button>
      ) : (
        <span className="text-[11px] text-text-muted">Press Publish above ↑</span>
      )}
    </div>
  );
}

// ────────── Step 1 ──────────

function Step1({
  state,
  today,
  maxDate,
  minTimeForToday,
  venues,
  setState,
}: {
  state: WizardState;
  today: string;
  maxDate: string;
  minTimeForToday: string | null;
  venues: readonly VenueView[];
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const filteredVenues = React.useMemo(() => {
    const q = state.venueSearch.trim().toLowerCase();
    if (!q) return venues;
    return venues.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.address.toLowerCase().includes(q),
    );
  }, [state.venueSearch, venues]);

  // ── Venue combobox: list stays collapsed until the field is focused /
  //    typed into; once a venue is chosen we show a compact card + "Change". ──
  const [venueOpen, setVenueOpen] = React.useState(false);
  const venueComboRef = React.useRef<HTMLDivElement>(null);
  const venueInputRef = React.useRef<HTMLInputElement>(null);

  const selectedVenue = React.useMemo(
    () => (state.venueId ? venues.find((v) => v.id === state.venueId) ?? null : null),
    [state.venueId, venues],
  );

  // Close the dropdown on outside click (mirrors MatchHeaderMenu).
  React.useEffect(() => {
    if (!venueOpen) return;
    const handler = (e: MouseEvent) => {
      if (venueComboRef.current && !venueComboRef.current.contains(e.target as Node)) {
        setVenueOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [venueOpen]);

  // Whenever the combobox opens (focus or "Change"), put the cursor in the input.
  React.useEffect(() => {
    if (venueOpen) venueInputRef.current?.focus();
  }, [venueOpen]);

  const selectVenue = (v: VenueView) => {
    setState((s) => ({
      ...s,
      venueId: v.id,
      surface: v.surface[0]!,
      studsAllowed: v.surface[0] === "hard" ? false : s.studsAllowed,
    }));
    setVenueOpen(false);
  };

  const changeVenue = () => {
    setState((s) => ({ ...s, venueSearch: "" }));
    setVenueOpen(true);
  };

  return (
    <>
      <section>
        <FieldLabel>Date</FieldLabel>
        <CalendarGrid
          selected={state.date}
          minDate={today}
          maxDate={maxDate}
          onSelect={(d) =>
            setState((s) => ({
              ...s,
              date: d,
              // If switching off "today" frees up any past-time, keep value;
              // if switching to "today" and the value is before now+30, the
              // input UI will mark it red via min attribute.
            }))
          }
        />
        <p className="mt-1.5 text-[12px] text-text-secondary">
          You can schedule up to 3 weeks ahead.
        </p>
      </section>

      <section>
        <FieldLabel>Time</FieldLabel>
        <div className="flex items-center gap-2.5">
          <Input
            type="time"
            value={state.time}
            min={minTimeForToday ?? undefined}
            onChange={(e) =>
              setState((s) => ({ ...s, time: e.target.value }))
            }
            className="w-[110px] text-center font-semibold tracking-wider"
          />
          <span className="text-[12px] leading-tight text-text-secondary">
            Prague time
            <br />
            {minTimeForToday ? `Min ${minTimeForToday} (30 min from now).` : "Any time today."}
          </span>
        </div>
        {minTimeForToday && state.time !== "" && state.time < minTimeForToday && (
          <p className="mt-1.5 text-[12px] font-semibold text-destructive">
            Match must start at least 30 minutes from now.
          </p>
        )}
      </section>

      <section>
        <FieldLabel>Duration</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {[60, 90, 120].map((d) => (
            <Chip
              key={d}
              active={state.duration === d}
              onClick={() => setState((s) => ({ ...s, duration: d }))}
            >
              {d} min
            </Chip>
          ))}
        </div>
      </section>

      <section>
        <FieldLabel>Venue</FieldLabel>

        {selectedVenue && !venueOpen ? (
          <button
            type="button"
            onClick={changeVenue}
            className="flex w-full items-center gap-2.5 rounded-[10px] border-[1.5px] border-green-dark bg-bg-card p-3 text-left"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[8px] text-[14px]"
              style={
                selectedVenue.photoUrl
                  ? undefined
                  : { background: coverBackground(selectedVenue.coverId) }
              }
            >
              {selectedVenue.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={selectedVenue.photoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                "⚽"
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold leading-tight">
                {selectedVenue.name}
              </div>
              <div className="mt-0.5 truncate text-[12px] text-text-secondary">
                {selectedVenue.address}
              </div>
            </div>
            <span className="shrink-0 self-center text-[12px] font-semibold text-green-dark">
              Change
            </span>
          </button>
        ) : (
          <div ref={venueComboRef} className="relative">
            <div className="relative">
              <MagnifyingGlass
                size={16}
                weight="bold"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary"
              />
              <Input
                ref={venueInputRef}
                type="search"
                placeholder="Search venue…"
                value={state.venueSearch}
                onFocus={() => setVenueOpen(true)}
                onChange={(e) => {
                  const venueSearch = e.target.value;
                  setState((s) => ({ ...s, venueSearch }));
                  setVenueOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setVenueOpen(false);
                    e.currentTarget.blur();
                  }
                }}
                className="pl-9"
              />
            </div>
            {venueOpen && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-[300px] overflow-y-auto rounded-[14px] border border-border bg-bg-base p-1.5 shadow-card">
                <div className="flex flex-col gap-1.5">
                  {filteredVenues.map((v) => (
                    <VenueItem
                      key={v.id}
                      venue={v}
                      selected={state.venueId === v.id}
                      onSelect={() => selectVenue(v)}
                    />
                  ))}
                  {filteredVenues.length === 0 && (
                    <p className="px-2 py-3 text-[13px] text-text-secondary">
                      No venues match &ldquo;{state.venueSearch}&rdquo;.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <p className="mt-1.5 text-[12px] text-text-secondary">
          Can&rsquo;t find your spot? Venues are admin-managed in v1.
        </p>
      </section>
    </>
  );
}

function CalendarGrid({
  selected,
  minDate,
  maxDate,
  onSelect,
}: {
  selected: string;
  minDate: string;
  maxDate: string;
  onSelect: (ymd: string) => void;
}) {
  const selectedParts = ymdToParts(selected);
  const [view, setView] = React.useState<{ year: number; month: number }>({
    year: selectedParts.year,
    month: selectedParts.month,
  });

  React.useEffect(() => {
    // Keep view in sync if `selected` jumps to a different month externally.
    setView({ year: selectedParts.year, month: selectedParts.month });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const firstYmd = `${view.year}-${String(view.month).padStart(2, "0")}-01`;
  const offset = isoWeekday(firstYmd);
  const total = daysInMonth(view.year, view.month);
  const cells: Array<{ ymd: string; day: number } | null> = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= total; d++) {
    cells.push({
      ymd: `${view.year}-${String(view.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
      day: d,
    });
  }

  const minParts = ymdToParts(minDate);
  const maxParts = ymdToParts(maxDate);
  const monthMin = minParts.year * 12 + minParts.month - 1;
  const monthMax = maxParts.year * 12 + maxParts.month - 1;
  const monthCurrent = view.year * 12 + view.month - 1;
  const canGoPrev = monthCurrent > monthMin;
  const canGoNext = monthCurrent < monthMax;

  const stepMonth = (delta: number) => {
    setView((v) => {
      let m = v.month + delta;
      let y = v.year;
      while (m < 1) {
        m += 12;
        y -= 1;
      }
      while (m > 12) {
        m -= 12;
        y += 1;
      }
      return { year: y, month: m };
    });
  };

  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-[14px] font-bold">
          {MONTH_LABELS[view.month - 1]} {view.year}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            disabled={!canGoPrev}
            onClick={() => stepMonth(-1)}
            aria-label="Previous month"
            className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-border bg-bg-card text-text-secondary disabled:cursor-not-allowed disabled:opacity-35"
          >
            <CaretLeft size={14} weight="bold" />
          </button>
          <button
            type="button"
            disabled={!canGoNext}
            onClick={() => stepMonth(1)}
            aria-label="Next month"
            className="flex h-7 w-7 items-center justify-center rounded-[8px] border border-border bg-bg-card text-text-secondary disabled:cursor-not-allowed disabled:opacity-35"
          >
            <CaretRight size={14} weight="bold" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {DOW_LABELS.map((d) => (
          <span
            key={d}
            className="pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-text-muted"
          >
            {d}
          </span>
        ))}
        {cells.map((c, i) => {
          if (!c) return <span key={`pad-${i}`} className="aspect-square" />;
          const disabled = c.ymd < minDate || c.ymd > maxDate;
          const isSelected = c.ymd === selected;
          const isToday = c.ymd === minDate;
          return (
            <button
              key={c.ymd}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(c.ymd)}
              aria-pressed={isSelected}
              className={cn(
                "flex aspect-square items-center justify-center rounded-[8px] border border-transparent bg-bg-card text-[13px] font-medium",
                "hover:bg-bg-surface",
                disabled && "cursor-not-allowed bg-transparent text-text-muted hover:bg-transparent",
                isToday && !isSelected && "border-border-strong",
                isSelected && "bg-green-dark font-bold text-text-inverted hover:bg-green-dark",
              )}
            >
              {c.day}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VenueItem({
  venue,
  selected,
  onSelect,
}: {
  venue: VenueView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[10px] border-[1.5px] border-transparent bg-bg-card p-3 text-left",
        "hover:bg-bg-card-dim",
        selected && "border-green-dark hover:bg-bg-card",
      )}
    >
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[8px] text-[14px]"
        style={venue.photoUrl ? undefined : { background: coverBackground(venue.coverId) }}
      >
        {venue.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={venue.photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          "⚽"
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold leading-tight">
          {venue.name}
        </div>
        <div className="mt-0.5 truncate text-[12px] text-text-secondary">
          {venue.address}
        </div>
        <div className="mt-1.5 flex gap-1.5">
          {venue.surface.map((s) => (
            <span
              key={s}
              className="rounded-[4px] bg-bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary"
            >
              {s === "grass" ? "Grass" : "Hard"}
            </span>
          ))}
        </div>
      </div>
      {selected && (
        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center self-center rounded-full bg-green-dark text-[12px] text-text-inverted">
          ✓
        </span>
      )}
    </button>
  );
}

// ────────── Step 2 ──────────

function Step2({
  state,
  venue,
  setState,
}: {
  state: WizardState;
  venue: VenueView;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  const crewLimit = Math.max(0, state.totalSpots - 1);
  const crewAtLimit = state.crew.length >= crewLimit;
  const filled = 1 + state.crew.length;

  return (
    <>
      <section>
        <FieldLabel>Total spots</FieldLabel>
        <Stepper
          value={state.totalSpots}
          min={MIN_TOTAL}
          max={MAX_TOTAL}
          ariaLabel="Total spots"
          onChange={(n) => setState((s) => ({ ...s, totalSpots: n }))}
        />
        <p className="mt-1.5 text-[12px] text-text-secondary">
          Min {MIN_TOTAL} (4-a-side), max {MAX_TOTAL}. Default 14 = 7-a-side.
        </p>
      </section>

      <section>
        <FieldLabel>Players coming with you</FieldLabel>
        <CrewInput
          crew={state.crew}
          atLimit={crewAtLimit}
          onChange={(next) => setState((s) => ({ ...s, crew: next }))}
        />
        <p className="mt-2 text-[12px] text-text-secondary">
          Match will publish as{" "}
          <span className="font-bold text-green-dark">
            {filled}/{state.totalSpots}
          </span>{" "}
          — looking for {Math.max(0, state.totalSpots - filled)}.
        </p>
        <p className="mt-1.5 text-[12px] text-text-secondary">
          Add friends who are playing for sure. We&rsquo;ll mark their spots as filled.
        </p>
        {crewAtLimit && (
          <p className="mt-1 text-[12px] font-semibold text-status-almost">
            Already filling all spots. Increase Total to add more.
          </p>
        )}
      </section>

      <section>
        <FieldLabel>Surface</FieldLabel>
        {venue.surface.length === 1 ? (
          <div className="text-[14px] text-text-primary">
            {venue.surface[0] === "grass" ? "Grass" : "Hard surface"}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {venue.surface.map((s) => (
              <Chip
                key={s}
                active={state.surface === s}
                onClick={() =>
                  setState((prev) => ({
                    ...prev,
                    surface: s,
                    studsAllowed: s === "hard" ? false : prev.studsAllowed,
                  }))
                }
              >
                {s === "grass" ? "Grass" : "Hard surface"}
              </Chip>
            ))}
          </div>
        )}
        <p className="mt-1.5 text-[12px] text-text-secondary">
          Pre-filled from venue.
        </p>
      </section>

      {state.surface === "grass" && (
        <section>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold">Studs allowed</span>
              <span className="mt-0.5 text-[12px] text-text-secondary">
                Players may wear long studs on grass.
              </span>
            </div>
            <Switch
              checked={state.studsAllowed}
              onCheckedChange={(checked) =>
                setState((s) => ({ ...s, studsAllowed: checked }))
              }
              aria-label="Studs allowed"
            />
          </div>
        </section>
      )}

      <section>
        <label className="flex cursor-pointer items-center gap-2.5">
          <Checkbox
            checked={state.fieldBooked}
            onCheckedChange={(c) =>
              setState((s) => ({ ...s, fieldBooked: c === true }))
            }
            aria-label="Field is booked"
          />
          <div>
            <span className="block text-[14px] font-semibold">Field is booked</span>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              Can be set later via Edit.
            </p>
          </div>
        </label>
      </section>

      <section>
        <FieldLabel>Price per person</FieldLabel>
        <div className="flex items-stretch gap-2.5">
          <div
            className={cn(
              "flex h-[42px] flex-1 items-center rounded-[10px] border border-border bg-bg-card px-3",
              state.priceMode === "free" && "opacity-50",
            )}
          >
            <input
              type="number"
              inputMode="numeric"
              min={0}
              disabled={state.priceMode === "free"}
              value={state.priceText}
              onChange={(e) =>
                setState((s) => ({ ...s, priceText: e.target.value }))
              }
              placeholder="0"
              className="flex-1 border-none bg-transparent text-[14px] text-text-primary outline-none placeholder:text-text-muted"
            />
            <span className="text-[13px] font-semibold text-text-secondary">Kč</span>
          </div>
          <button
            type="button"
            onClick={() =>
              setState((s) => ({
                ...s,
                priceMode: s.priceMode === "free" ? "paid" : "free",
              }))
            }
            className={cn(
              "h-[42px] rounded-[10px] border border-border-strong bg-bg-card px-3.5 text-[13px] font-semibold",
              state.priceMode === "free"
                ? "border-green-dark bg-green-dark text-text-inverted"
                : "text-text-secondary hover:bg-bg-surface",
            )}
          >
            Free
          </button>
        </div>
      </section>
    </>
  );
}

function CrewInput({
  crew,
  atLimit,
  onChange,
}: {
  crew: string[];
  atLimit: boolean;
  onChange: (next: string[]) => void;
}) {
  const [value, setValue] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      setValue("");
      return;
    }
    if (trimmed.length > MAX_CREW_NAME) return;
    if (atLimit) return;
    onChange([...crew, trimmed]);
    setValue("");
  };

  const remove = (idx: number) => {
    onChange(crew.filter((_, i) => i !== idx));
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-[10px] border border-border bg-bg-card p-2"
      onClick={() => inputRef.current?.focus()}
    >
      {crew.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-chip bg-lime py-1 pl-2.5 pr-1 text-[13px] font-semibold text-lime-text"
        >
          {name}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              remove(i);
            }}
            aria-label={`Remove ${name}`}
            className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-lime-text/15"
          >
            <X size={10} weight="bold" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={atLimit}
        maxLength={MAX_CREW_NAME}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && value === "" && crew.length > 0) {
            onChange(crew.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={
          atLimit
            ? "All spots filled — bump Total to add more"
            : "Type a name and press Enter"
        }
        className="min-w-[120px] flex-1 border-none bg-transparent px-1.5 text-[14px] text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
      />
    </div>
  );
}

// ────────── Step 3 ──────────

function Step3({
  state,
  venue,
  setState,
  submitting,
  onPublish,
}: {
  state: WizardState;
  venue: VenueView;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
  submitting: boolean;
  onPublish: () => void;
}) {
  return (
    <>
      <section>
        <FieldLabel>
          Description <span className="font-medium text-text-muted">(optional)</span>
        </FieldLabel>
        <textarea
          value={state.description}
          maxLength={MAX_DESCRIPTION}
          onChange={(e) =>
            setState((s) => ({ ...s, description: e.target.value }))
          }
          placeholder="Tell players the details: meeting point, what to bring, skill level, etc."
          className="min-h-[96px] w-full resize-y rounded-[10px] border border-border bg-bg-card p-3 text-[14px] leading-snug text-text-primary placeholder:text-text-muted focus:border-border-focus focus:outline-none focus:ring-[3px] focus:ring-green-dark/10"
        />
        <p className="mt-1 text-right text-[11px] text-text-muted">
          {state.description.length} / {MAX_DESCRIPTION}
        </p>
      </section>

      <section>
        <FieldLabel>Preview</FieldLabel>
        <PreviewCard state={state} venue={venue} />
        <p className="mt-1.5 text-[12px] text-text-secondary">
          This is how the match will appear on Discover.
        </p>
      </section>

      <Button
        type="button"
        variant="primary"
        size="lg"
        onClick={onPublish}
        disabled={submitting}
      >
        {submitting ? "Publishing…" : "Publish match"}
      </Button>
    </>
  );
}

function PreviewCard({ state, venue }: { state: WizardState; venue: VenueView }) {
  const dateParts = ymdToParts(state.date);
  const dow = SHORT_DOW_LABELS[
    new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day)).getUTCDay()
  ];
  const whenStr = `${dow} ${dateParts.day} ${SHORT_MONTH_LABELS[dateParts.month - 1]} · ${state.time}`;
  const filled = 1 + state.crew.length;
  const price =
    state.priceMode === "free"
      ? "Free"
      : `${Math.max(0, Math.floor(Number(state.priceText) || 0))} Kč`;
  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-bg-card p-3.5 shadow-card">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
          {whenStr}
        </span>
        <span className="text-[11px] font-bold uppercase tracking-wider text-status-open">
          {filled} / {state.totalSpots} · Open
        </span>
      </div>
      <div className="text-[17px] font-bold leading-tight tracking-tight">
        {venue.name}
      </div>
      <div className="flex flex-wrap gap-2.5">
        <PreviewPill>{state.duration} min</PreviewPill>
        <PreviewPill>
          {state.surface === "grass" ? "Grass" : "Hard"}
        </PreviewPill>
        {state.fieldBooked && <PreviewPill>Booked</PreviewPill>}
        {state.surface === "grass" && state.studsAllowed && (
          <PreviewPill>Studs OK</PreviewPill>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-2">
        <span className="text-[14px] font-bold text-green-dark">
          {filled}
          <span className="font-medium text-text-secondary"> / {state.totalSpots}</span>
        </span>
        <span className="text-[14px] font-semibold">{price}</span>
      </div>
    </div>
  );
}

function PreviewPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[5px] bg-bg-surface px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
      {children}
    </span>
  );
}

// ────────── helpers ──────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-2 block text-[13px] font-semibold text-text-primary">
      {children}
    </label>
  );
}

function clampStep(n: number): 1 | 2 | 3 {
  if (n <= 1) return 1;
  if (n >= 3) return 3;
  return 2;
}

function defaultInitialTime(now: Date, today: string): string {
  // 19:00 Prague if that's still ≥30 min away; otherwise round up to the
  // next half-hour ≥ now+30min.
  const candidate = pragueWallClockToUtc(today, "19:00");
  if (candidate.getTime() >= now.getTime() + MIN_OFFSET_MIN * 60_000) {
    return "19:00";
  }
  const minTs = now.getTime() + MIN_OFFSET_MIN * 60_000;
  const rounded = Math.ceil(minTs / (30 * 60_000)) * 30 * 60_000;
  const { hour, minute } = pragueHourMinute(new Date(rounded));
  // If that rolls past midnight Prague — push back to "19:00" anyway; the UI
  // will surface the validation error when the user picks today.
  if (pragueDateString(new Date(rounded)) !== today) return "19:00";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function handleBackendError(
  body: { code?: string; meta?: Record<string, unknown> },
  setState: React.Dispatch<React.SetStateAction<WizardState>>,
  setToast: (msg: string | null) => void,
): void {
  switch (body.code) {
    case "invalid_start_time":
      setState((s) => ({ ...s, step: 1 }));
      setToast("Match must start at least 30 minutes from now.");
      return;
    case "too_far_ahead":
      setState((s) => ({ ...s, step: 1 }));
      setToast("Match date can't be more than 3 weeks ahead.");
      return;
    case "invalid_total_spots":
      setState((s) => ({ ...s, step: 2 }));
      setToast("Total spots must be between 8 and 30.");
      return;
    case "invalid_crew_name":
      setState((s) => ({ ...s, step: 2 }));
      setToast("Each crew name must be 1–30 characters.");
      return;
    case "captain_crew_overflow":
      setState((s) => ({ ...s, step: 2 }));
      setToast("Crew exceeds total spots — bump Total or remove a name.");
      return;
    case "invalid_surface":
      setState((s) => ({ ...s, step: 2 }));
      setToast("Selected surface is not available at this venue.");
      return;
    case "venue_inactive":
      setState((s) => ({
        ...s,
        step: 1,
        venueId: null,
        surface: null,
      }));
      setToast("This venue is no longer available. Pick another.");
      return;
    case "venue_not_found":
      setState((s) => ({ ...s, step: 1, venueId: null, surface: null }));
      setToast("Venue not found. Pick another.");
      return;
    case "no_session":
    case "user_not_found":
    case "banned":
    case "deleted":
      setToast("Please sign in again.");
      return;
    default:
      setToast("Couldn't publish. Try again.");
  }
}
