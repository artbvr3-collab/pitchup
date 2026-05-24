# bounded context: notifications

**Purpose.** In-app inbox (Updates panel), browser push (Notification API), transactional email. Drives the global poll endpoint `GET /api/updates/state`.

**Core entities (planned).** `Notification`, `NotificationKind` (approve / reject / kick / cancel / edit-material / etc.), per-user delivery preferences.

**Key use cases.** `EnqueueNotificationService`, `MarkReadService`, `PollUpdatesService`.

**Invariants.**
- Material vs non-material edit distinction is enforced here: editing `start_time`/`duration`/`venue`/`surface`/`studs_allowed`/`price`/`field_booked` triggers notifications; editing `total_spots`/`captain_crew`/`description` is silent (except `total_spots ↑` may notify watching).
- Author rendering at read-time: messages from banned/deleted users render as `[Removed user]`.

**External dependencies (ports, planned).** `NotificationRepository`, `EmailSender` (Resend / Postmark — TBD per `docs/ARCHITECTURE.md` §16), `BrowserPushSender`.

**Status.** Empty — populated at Layer 7.

**Related docs.** `docs/spec/pitchup-spec-global.md` → "Polling sync", `docs/ARCHITECTURE.md` §10.
