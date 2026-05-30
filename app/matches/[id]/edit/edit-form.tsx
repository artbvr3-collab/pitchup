/**
 * MODULE: app.matches.id.edit.edit-form
 * PURPOSE: Client island for `PATCH /api/matches/:id` (captain edit).
 *          Renders the editable subset (description, total_spots,
 *          captain_crew chips, surface, studs_allowed, price, field_booked)
 *          and submits a partial patch with the RSC-captured `updated_at`
 *          probe for optimistic concurrency. Only changed fields are sent
 *          on the wire (true patch semantics — server keys with `undefined`
 *          values mean "don't touch").
 * LAYER: interfaces (client)
 * INVARIANTS:
 *   - `updated_at` from props is sent as-is (ISO string) — the server parses
 *     it back into a `Date` and compares via `getTime()` under the lock.
 *   - Stepper `[−]` is disabled when `totalSpots <= max(8, filled)` so the
 *     UI mirrors the backend `capacity_below_filled` guard (spec §634);
 *     the 409 toast is the canonical recovery path when the form is stale.
 *   - Surface switch: when `venue.surfaces` has only one entry, the
 *     selector is hidden (no choice to make). Grass→Hard force-resets
 *     `studsAllowed` locally too (so the preview matches what the server
 *     will write — spec §669); the server does the canonical fold.
 *   - On `409 concurrent_modification` we surface a toast and reload (spec
 *     §665: "Match was updated in another tab. Reload."). On
 *     `409 capacity_below_filled` we surface the message and let the user
 *     adjust (do not reload — they'd lose unsaved field edits).
 *   - This island is intentionally one wide file (single-screen form,
 *     mid-200 LOC). If a third Edit-like form lands, extract a shared
 *     EditForm primitive.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id/edit", "Backend
 *     validation errors on edit save"
 *   - docs/spec/pitchup-spec-global.md → "Text field validation &
 *     sanitization", "Total spots — hard cap on approve"
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/src/ui/components/button";
import { Checkbox } from "@/src/ui/components/checkbox";
import { Stepper } from "@/src/ui/components/stepper";
import { Switch } from "@/src/ui/components/switch";
import { cn } from "@/src/ui/lib/cn";

export interface EditMatchFormProps {
  readonly matchId: string;
  /**
   * API endpoint to submit the PATCH to. Defaults to `/api/matches/:id`
   * (captain flow). The admin edit page passes `/api/admin/matches/:id` so
   * it lands on the admin-gated endpoint (Layer 9c).
   */
  readonly submitUrl?: string;
  readonly initial: {
    readonly updatedAt: string; // ISO
    readonly description: string | null;
    readonly totalSpots: number;
    readonly captainCrew: readonly string[];
    readonly surface: "grass" | "hard";
    readonly studsAllowed: boolean;
    readonly price: number;
    readonly fieldBooked: boolean;
    /** computeSlots(match).filled at RSC render — drives stepper minimum. */
    readonly filled: number;
  };
  readonly venue: {
    readonly name: string;
    readonly surfaces: readonly ("grass" | "hard")[];
  };
}

const MAX_DESC = 2000;
const MAX_CREW_NAME = 30;

export function EditMatchForm(props: EditMatchFormProps) {
  const router = useRouter();

  const [description, setDescription] = useState<string>(
    props.initial.description ?? "",
  );
  const [totalSpots, setTotalSpots] = useState<number>(
    props.initial.totalSpots,
  );
  const [crew, setCrew] = useState<readonly string[]>(props.initial.captainCrew);
  const [crewDraft, setCrewDraft] = useState("");
  const [surface, setSurface] = useState<"grass" | "hard">(
    props.initial.surface,
  );
  const [studsAllowed, setStudsAllowed] = useState<boolean>(
    surface === "hard" ? false : props.initial.studsAllowed,
  );
  const [price, setPrice] = useState<number>(props.initial.price);
  const [freeMatch, setFreeMatch] = useState<boolean>(props.initial.price === 0);
  const [fieldBooked, setFieldBooked] = useState<boolean>(
    props.initial.fieldBooked,
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stepper minimum: tracks current filled + crew live, so removing a stub
  // immediately drops the floor (parity with /matches/new step 2 spec §634).
  const liveFilled = props.initial.filled - props.initial.captainCrew.length + crew.length;
  const totalMin = Math.max(8, liveFilled);

  const addCrew = () => {
    const trimmed = crewDraft.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_CREW_NAME) return;
    setCrew([...crew, trimmed]);
    setCrewDraft("");
  };

  const removeCrew = (index: number) => {
    setCrew(crew.filter((_, i) => i !== index));
  };

  const flipSurface = (next: "grass" | "hard") => {
    setSurface(next);
    if (next === "hard") setStudsAllowed(false);
  };

  // Build the wire patch: include ONLY fields that actually changed vs
  // initial. Sending unchanged keys is harmless (server's `update()` only
  // applies present keys), but keeping the payload minimal makes server
  // logs honest about what the captain touched + makes diff-based Layer 7
  // notification logic straightforward.
  const buildPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {
      updated_at: props.initial.updatedAt,
    };

    const initDesc = props.initial.description ?? "";
    if (description !== initDesc) {
      // Empty string means "clear" — send as null (description: string | null).
      patch.description = description.length === 0 ? null : description;
    }
    if (totalSpots !== props.initial.totalSpots) {
      patch.total_spots = totalSpots;
    }
    if (!sameStringArray(crew, props.initial.captainCrew)) {
      patch.captain_crew = crew;
    }
    if (surface !== props.initial.surface) {
      patch.surface = surface;
    }
    // studs_allowed: include if the user changed it, OR if surface flipped to
    // hard (so the server sees the force-reset intent explicitly even though
    // it'd fold the same value server-side).
    const effectiveStuds = surface === "hard" ? false : studsAllowed;
    if (effectiveStuds !== props.initial.studsAllowed) {
      patch.studs_allowed = effectiveStuds;
    }
    const effectivePrice = freeMatch ? 0 : price;
    if (effectivePrice !== props.initial.price) {
      patch.price = effectivePrice;
    }
    if (fieldBooked !== props.initial.fieldBooked) {
      patch.field_booked = fieldBooked;
    }
    return patch;
  };

  const submit = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const patch = buildPatch();
      // No editable fields touched → just bounce back.
      if (Object.keys(patch).length === 1) {
        router.push(`/matches/${props.matchId}`);
        return;
      }
      const url = props.submitUrl ?? `/api/matches/${props.matchId}`;
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          code?: string;
          meta?: Record<string, unknown>;
        } | null;
        // Spec §665: concurrent_modification → reload (with a toast).
        if (body?.code === "concurrent_modification") {
          window.alert("Match was updated in another tab.");
          window.location.reload();
          return;
        }
        setError(messageForCode(body?.code, body?.meta));
        return;
      }
      router.push(`/matches/${props.matchId}`);
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const descCounterClass =
    description.length >= MAX_DESC
      ? "text-destructive"
      : description.length >= MAX_DESC - 100
        ? "text-status-almost"
        : "text-text-muted";

  const showSurfaceToggle = props.venue.surfaces.length > 1;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <section className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-text-secondary">
          Venue
        </p>
        <p className="text-sm font-medium">{props.venue.name}</p>
        <p className="text-xs text-text-muted">
          Venue, date and time are locked. Cancel and create a new match to
          reschedule.
        </p>
      </section>

      <label className="flex flex-col gap-1">
        <span className="text-xs uppercase tracking-wide text-text-secondary">
          Description
        </span>
        <textarea
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC))}
          className="w-full resize-none rounded-btn border border-border bg-bg-card p-2 text-sm focus:border-border-focus focus:outline-none"
        />
        <span className={cn("text-right text-xs", descCounterClass)}>
          {description.length}/{MAX_DESC}
        </span>
      </label>

      <section className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-text-secondary">
          Total spots
        </p>
        <Stepper
          value={totalSpots}
          min={totalMin}
          max={30}
          onChange={setTotalSpots}
        />
        {totalSpots <= totalMin ? (
          <p className="text-xs text-text-muted">
            To lower below {totalMin}, kick a player or remove a name from
            “Players coming with you” first.
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-text-secondary">
          Players coming with you
        </p>
        <div className="flex flex-wrap gap-1.5">
          {crew.map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="inline-flex items-center gap-1 rounded-chip bg-lime/40 px-2 py-1 text-xs font-semibold text-lime-text"
            >
              {name}
              <button
                type="button"
                onClick={() => removeCrew(i)}
                aria-label={`Remove ${name}`}
                className="font-bold"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={crewDraft}
            maxLength={MAX_CREW_NAME}
            onChange={(e) => setCrewDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addCrew();
              }
            }}
            placeholder="Type a name and press Enter"
            className="h-9 flex-1 rounded-btn border border-border bg-bg-card px-2 text-sm focus:border-border-focus focus:outline-none"
          />
          <Button
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              addCrew();
            }}
            className="w-auto px-3"
          >
            Add
          </Button>
        </div>
      </section>

      {showSurfaceToggle ? (
        <section className="flex flex-col gap-1">
          <p className="text-xs uppercase tracking-wide text-text-secondary">
            Surface
          </p>
          <div className="flex gap-2">
            {(["grass", "hard"] as const)
              .filter((s) => props.venue.surfaces.includes(s))
              .map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => flipSurface(s)}
                  className={cn(
                    "rounded-chip border px-3 py-1 text-xs font-semibold",
                    surface === s
                      ? "border-green-dark bg-green-dark text-text-inverted"
                      : "border-border-strong bg-bg-card text-text-primary",
                  )}
                >
                  {s === "grass" ? "Grass" : "Hard"}
                </button>
              ))}
          </div>
        </section>
      ) : null}

      {surface === "grass" ? (
        <section className="flex items-center justify-between">
          <span className="text-sm">Studs allowed</span>
          <Switch
            checked={studsAllowed}
            onCheckedChange={setStudsAllowed}
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-text-secondary">
          Price per person (Kč)
        </p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={freeMatch ? 0 : price}
            disabled={freeMatch}
            onChange={(e) =>
              setPrice(Math.max(0, Number.parseInt(e.target.value, 10) || 0))
            }
            className="h-9 w-28 rounded-btn border border-border bg-bg-card px-2 text-sm focus:border-border-focus focus:outline-none disabled:opacity-50"
          />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={freeMatch}
              onCheckedChange={(v) => setFreeMatch(Boolean(v))}
            />
            Free match
          </label>
        </div>
      </section>

      <section className="flex items-center gap-2">
        <Checkbox
          checked={fieldBooked}
          onCheckedChange={(v) => setFieldBooked(Boolean(v))}
        />
        <span className="text-sm">Field is booked</span>
      </section>

      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving…" : "Save changes"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => router.push(`/matches/${props.matchId}`)}
        >
          Discard
        </Button>
      </div>
    </form>
  );
}

function sameStringArray(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function messageForCode(
  code: string | undefined,
  meta: Record<string, unknown> | undefined,
): string {
  switch (code) {
    case "capacity_below_filled": {
      const filled =
        typeof meta?.filled === "number" ? meta.filled : "current players";
      return `Can't lower below current players (${filled}).`;
    }
    case "match_locked":
      return "Match just started — edits closed.";
    case "concurrent_modification":
      // Caught upstream; defensive.
      return "Match was updated in another tab. Refresh and try again.";
    case "not_captain":
      return "Only the captain can edit this match.";
    case "invalid_total_spots":
      return "Total spots must be between 8 and 30.";
    case "invalid_crew_name":
      return "Crew names must be 1–30 characters.";
    case "invalid_surface":
      return "Selected surface is not available at this venue.";
    case "invalid_price":
      return "Price must be a non-negative integer.";
    case "validation_failed":
      return "Some fields are invalid. Check your input.";
    default:
      return "Couldn't save changes. Try again.";
  }
}
