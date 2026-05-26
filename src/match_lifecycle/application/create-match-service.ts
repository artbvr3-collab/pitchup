/**
 * MODULE: match_lifecycle.application.create-match-service
 * PURPOSE: Use case — captain publishes a new match. Validates input against
 *          the venue row + current time, snapshots `coverId` from the venue,
 *          and persists. First mutating service in the codebase.
 * LAYER: application
 * DEPENDENCIES (ports): MatchRepository, VenueRepository
 * CONSUMED BY: app/api/matches/route.ts (POST)
 * INVARIANTS:
 *   - `start_time >= now + 30min` (UTC compare).
 *   - `start_time < prague_day(today_prague(now) + 20).utcEnd` — the 21-day
 *     horizon. end_time may spill past it; only start_time is bounded.
 *   - `total_spots ∈ [8, 30]` (Zod also enforces, defence in depth).
 *   - Each crew name is trimmed; empty-after-trim is rejected; > 30 chars
 *     rejected.
 *   - `1 + captainCrew.length <= total_spots` (the captain occupies 1 slot).
 *   - `surface` must be offered by the venue; for `hard`, `studsAllowed` is
 *     coerced to false defensively (UI hides the toggle).
 *   - Venue must exist (`venue_not_found`) and be `active = true`
 *     (`venue_inactive`).
 *   - `coverId` is taken from the venue row at INSERT — immutable thereafter.
 *   - No advisory lock (spec: "Concurrency & locking" → exceptions, the id
 *     doesn't exist yet).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/new", "Per-endpoint checklist"
 *   - docs/spec/pitchup-spec-global.md → "Timezones & date ranges"
 */
import { asUserId, type UserId } from "@/src/auth/domain/user";
import { addPragueDays, pragueDay, todayPrague } from "@/src/shared/time/prague";
import {
  CaptainCrewOverflowError,
  InvalidCrewNameError,
  InvalidStartTimeError,
  InvalidSurfaceError,
  InvalidTotalSpotsError,
  TooFarAheadError,
  VenueInactiveError,
  VenueNotFoundError,
} from "../domain/errors";
import { asMatchId, type MatchId } from "../domain/match";
import type { MatchRepository } from "../domain/match-repository";
import { asVenueId, type Surface } from "../domain/venue";
import type { VenueRepository } from "../domain/venue-repository";
import type { CreateMatchInput } from "./dto/create-match-input";

const MIN_START_OFFSET_MS = 30 * 60 * 1000;
const HORIZON_DAYS = 20;
const MIN_TOTAL_SPOTS = 8;
const MAX_TOTAL_SPOTS = 30;
const MAX_CREW_NAME_LEN = 30;

export interface CreateMatchResult {
  readonly id: MatchId;
}

export class CreateMatchService {
  constructor(
    private readonly matchRepository: MatchRepository,
    private readonly venueRepository: VenueRepository,
  ) {}

  async execute(input: CreateMatchInput, now: Date): Promise<CreateMatchResult> {
    // 1. Total spots — defence in depth (Zod also enforces).
    if (
      !Number.isInteger(input.totalSpots) ||
      input.totalSpots < MIN_TOTAL_SPOTS ||
      input.totalSpots > MAX_TOTAL_SPOTS
    ) {
      throw new InvalidTotalSpotsError({ totalSpots: input.totalSpots });
    }

    // 2. Start time bounds.
    const startMs = input.startTime.getTime();
    if (!Number.isFinite(startMs)) {
      throw new InvalidStartTimeError({ startTime: input.startTime });
    }
    if (startMs < now.getTime() + MIN_START_OFFSET_MS) {
      throw new InvalidStartTimeError({
        startTime: input.startTime,
        minStartTime: new Date(now.getTime() + MIN_START_OFFSET_MS),
      });
    }
    const horizonEnd = pragueDay(addPragueDays(todayPrague(now), HORIZON_DAYS)).utcEnd;
    if (startMs >= horizonEnd.getTime()) {
      throw new TooFarAheadError({ startTime: input.startTime, horizonEnd });
    }

    // 3. Crew — trim, validate, ignore empty (mirrors the UI's "blank chip
    //    not created" rule); duplicates allowed per spec.
    const captainCrew = normalizeCrew(input.captainCrew);
    if (1 + captainCrew.length > input.totalSpots) {
      throw new CaptainCrewOverflowError({
        crewSize: captainCrew.length,
        totalSpots: input.totalSpots,
      });
    }

    // 4. Venue must exist and be active.
    const venue = await this.venueRepository.findById(asVenueId(input.venueId));
    if (!venue) {
      throw new VenueNotFoundError({ venueId: input.venueId });
    }
    if (!venue.active) {
      throw new VenueInactiveError({ venueId: input.venueId });
    }

    // 5. Surface must be one of the venue's offerings.
    if (!venue.surface.includes(input.surface)) {
      throw new InvalidSurfaceError({
        requested: input.surface,
        venueOffers: venue.surface,
      });
    }

    // 6. Studs only meaningful on grass; force false on hard.
    const studsAllowed: boolean =
      input.surface === "hard" ? false : input.studsAllowed;

    const surface: Surface = input.surface;
    const captainId: UserId = asUserId(input.captainId);

    const id = await this.matchRepository.create({
      captainId,
      venueId: venue.id,
      startTime: input.startTime,
      duration: input.duration,
      totalSpots: input.totalSpots,
      price: input.price,
      surface,
      studsAllowed,
      fieldBooked: input.fieldBooked,
      description: normalizeDescription(input.description),
      captainCrew,
      coverId: venue.coverId,
    });

    return { id: asMatchId(id) };
  }
}

function normalizeCrew(crew: readonly string[]): readonly string[] {
  const normalized: string[] = [];
  for (const raw of crew) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue; // ignore blanks (UI parity)
    if (trimmed.length > MAX_CREW_NAME_LEN) {
      throw new InvalidCrewNameError({ name: trimmed, maxLen: MAX_CREW_NAME_LEN });
    }
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeDescription(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
