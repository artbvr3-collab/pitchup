# bounded context: notifications

**Purpose.** In-app inbox (Updates panel), browser push (Notification API), transactional email. Drives the global poll endpoint `GET /api/updates/state`.

**Core entities.** `Notification` (`domain/notification.ts`) with the closed `NotificationType` enum (`approved` / `rejected` / `kicked` / `match_cancelled` / `match_updated` / `spot_opened` / `morning_reminder`). Canonical EN body strings live in `domain/notification-bodies.ts`.

**Key use cases.** `UpdatesStateService` (`application/` — assembles the `GET /api/updates/state` payload). Write-side notifications are inserted by the `match_lifecycle` services at their event sites via the injected `NotificationRepository` port (in-tx). Mark-as-read is a thin endpoint over `NotificationRepository.markAllRead`.

**Invariants.**
- Material vs non-material edit distinction is enforced here: editing `start_time`/`duration`/`venue`/`surface`/`studs_allowed`/`price`/`field_booked` triggers notifications; editing `total_spots`/`captain_crew`/`description` is silent (except `total_spots ↑` may notify watching).
- Author rendering at read-time: messages from banned/deleted users render as `[Removed user]`.

**External dependencies (ports).** `NotificationRepository` (`domain/notification-repository.ts`) — Prisma adapter in `infrastructure/`. Planned for 7b: `EmailSender` (Resend, ADR-0004) + browser Notification API (client-only, no port).

**Status.** Layer 7a in progress — in-app inbox + polling. 7b (email + browser + cron) deferred.

**Related docs.** `docs/spec/pitchup-spec-global.md` → "Polling sync", `docs/ARCHITECTURE.md` §10.
