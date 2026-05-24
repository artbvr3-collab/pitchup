# bounded context: moderation

**Purpose.** User reports, admin actions (ban, soft-delete, venue/match takedowns), admin dashboards.

**Core entities (planned).** `Report`, `AdminAction`.

**Key use cases.** `FileReportService`, `BanUserService`, `RestoreUserService`, `RemoveContentService`.

**Invariants.**
- Bans take effect on the next `requireAuth()` call (see `auth` context) — no live session kill.
- Admin-only endpoints call `requireAdmin()` in addition to `requireAuth()`.

**External dependencies (ports, planned).** `ReportRepository`, `UserRepository` (from `auth` context — read-only here), `NotificationSender`.

**Status.** Empty — populated at Layer 9.

**Related docs.** `docs/spec/pitchup-spec-global.md` → "Session invalidation".
