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

// ---------------------------------------------------------------------------
// Layer 4 — Join / Approve / Reject
// Codes mirror docs/spec/pitchup-spec-match.md → "Per-endpoint checklist".
// ---------------------------------------------------------------------------

/**
 * `404 match_not_found` — the match id does not exist (or was hard-deleted by
 * admin). Distinct from `match_locked`, which means the match exists but its
 * computed status is not `live`.
 */
export class MatchNotFoundError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("match_not_found", "Match not found", 404, meta);
  }
}

/**
 * `409 match_locked` — the match's computed status is not `live`
 * (InProgress / Ended / Cancelled), so the operation is refused regardless
 * of slots or role. Same code is used for "start_time already passed but
 * cron hasn't run yet" — status is computed on-read.
 */
export class MatchLockedError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("match_locked", "Match is no longer open for changes", 409, meta);
  }
}

/**
 * `400 captain_cannot_join` — the authenticated user is the captain of this
 * match. Backstop against a direct curl; the UI hides the Join button.
 */
export class CaptainCannotJoinError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("captain_cannot_join", "Captain cannot join their own match", 400, meta);
  }
}

/**
 * `409 already_requested` — a JoinRequest with status=`pending` already exists
 * for this (match, user) pair. Idempotency: client may retry on a flaky
 * network and see this — treat as success-no-op in the UI.
 */
export class AlreadyRequestedError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("already_requested", "You already applied to this match", 409, meta);
  }
}

/**
 * `409 already_in_match` — a JoinRequest with status=`accepted` already exists
 * for this (match, user) pair (the player is already on the roster).
 */
export class AlreadyInMatchError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("already_in_match", "You are already on this match's roster", 409, meta);
  }
}

/**
 * `409 over_capacity` — approving this request would push computed
 * `filled` past `total_spots`. Captain UX is to raise total via Edit, then
 * approve. Hard cap is canonical — spec global.md "Total spots — hard cap".
 */
export class OverCapacityError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("over_capacity", "Not enough spots to approve this request", 409, meta);
  }
}

/**
 * `404 request_not_found` — the JoinRequest id does not exist, or does not
 * belong to this match. Returned by Approve / Reject when the targeted row
 * cannot be located under the lock.
 */
export class RequestNotFoundError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("request_not_found", "Join request not found", 404, meta);
  }
}

/**
 * `409 already_processed` — the JoinRequest exists but its status is no longer
 * `pending` (already accepted by another captain tab, auto-rejected by cron,
 * cancelled by the user, or terminal in some other way).
 */
export class AlreadyProcessedError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("already_processed", "Join request has already been processed", 409, meta);
  }
}

/**
 * `403 not_captain` — the authenticated user is not the captain of this
 * match. Backstop against direct curl on Approve / Reject (UI hides the
 * captain sheet for non-captains, see spec match.md → `[Manage match]`
 * visibility).
 */
export class NotCaptainError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("not_captain", "Only the captain can perform this action", 403, meta);
  }
}

// ---------------------------------------------------------------------------
// Layer 6 — Leave / CancelRequest / Watch / Unwatch
// Codes mirror docs/spec/pitchup-spec-match.md → "Per-endpoint checklist"
// (POST /leave, /cancel-request, /watch + DELETE /watch).
// ---------------------------------------------------------------------------

/**
 * `404 not_in_match` — `POST /leave` was called for a (match, user) pair
 * that has no JoinRequest row or one with a non-`accepted` status. Frontend
 * treats this as success-no-op (the desired state "user not in match" is
 * already true). Spec match.md → "Per-endpoint checklist" → POST /leave.
 */
export class NotInMatchError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("not_in_match", "You are not on this match's roster", 404, meta);
  }
}

/**
 * `400 captain_cannot_watch` — the captain tapped `[Notify me]` on their
 * own match (backstop against direct curl; the UI hides the button via
 * `computeCta` which never produces `notifyMe` for the captain branch).
 * Spec match.md → "Per-endpoint checklist" → POST /watch.
 */
export class CaptainCannotWatchError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super(
      "captain_cannot_watch",
      "Captain cannot watch their own match",
      400,
      meta,
    );
  }
}

/**
 * `409 not_full` — `POST /watch` was called on a match where
 * `computeSlots(match).isFull === false`. Caused by a race: the user opened
 * a full match in the background, someone left + `notify watching` ran +
 * Watch rows were cleared, the user returned and tapped `[Notify me]`
 * without seeing the update. Spec match.md → "Per-endpoint checklist" +
 * "Watching logic" → "Watch is only created on a full match". Frontend toast:
 * `"A spot just opened — refresh to join"` + CTA redraws to `[Join match]`.
 */
export class MatchNotFullError extends AppError {
  constructor(meta: Record<string, unknown> = {}) {
    super("not_full", "Match is not full — no need to watch", 409, meta);
  }
}
