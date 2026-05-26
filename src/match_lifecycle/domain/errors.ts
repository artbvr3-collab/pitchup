/**
 * MODULE: match_lifecycle.domain.errors
 * PURPOSE: Domain errors raised by match_lifecycle services. Codes are part of
 *          the public API contract — they appear in `{ code }` bodies returned
 *          by Route Handlers and drive client-side toasts and redirects.
 *          Map 1:1 to the per-endpoint checklist in spec/pitchup-spec-match.md.
 * LAYER: domain
 * DEPENDENCIES: src/shared/errors/app-error
 * CONSUMED BY: src/match_lifecycle/application/*, src/shared/errors/http-mapping
 * INVARIANTS:
 *   - One concrete class per spec error code (no overloaded codes via `meta`).
 *   - `meta` carries the offending values for the HTTP layer to surface or log.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Per-endpoint checklist",
 *     "/matches/new" → "Backend validation errors on [Publish match]"
 */
import { AppError } from "@/src/shared/errors/app-error";

/** `400 invalid_start_time` — start_time < now + 30min (UTC compare). */
export class InvalidStartTimeError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("invalid_start_time", "Start time must be at least 30 minutes from now", 400, meta);
  }
}

/** `400 too_far_ahead` — start_time outside the 21-day Prague horizon. */
export class TooFarAheadError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("too_far_ahead", "Match date can't be more than 3 weeks ahead", 400, meta);
  }
}

/** `400 invalid_total_spots` — total_spots < 8 or > 30. */
export class InvalidTotalSpotsError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("invalid_total_spots", "Total spots must be between 8 and 30", 400, meta);
  }
}

/** `400 invalid_crew_name` — empty after trim or length > 30. */
export class InvalidCrewNameError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("invalid_crew_name", "Crew name must be 1–30 characters", 400, meta);
  }
}

/** `400 invalid_duration` — value outside the accepted set. */
export class InvalidDurationError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("invalid_duration", "Duration must be a positive number of minutes (max 240)", 400, meta);
  }
}

/** `400 invalid_surface` — surface not offered by the chosen venue. */
export class InvalidSurfaceError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("invalid_surface", "Selected surface is not available at this venue", 400, meta);
  }
}

/** `400 invalid_price` — non-integer / negative. */
export class InvalidPriceError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("invalid_price", "Price must be a non-negative integer", 400, meta);
  }
}

/** `400 captain_crew_overflow` — `1 + crew.length > total_spots`. */
export class CaptainCrewOverflowError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("captain_crew_overflow", "Crew exceeds total spots", 400, meta);
  }
}

/** `404 venue_not_found` — venue id does not exist. */
export class VenueNotFoundError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("venue_not_found", "Venue not found", 404, meta);
  }
}

/** `409 venue_inactive` — admin deactivated the venue between page load and submit. */
export class VenueInactiveError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("venue_inactive", "This venue is no longer available", 409, meta);
  }
}
