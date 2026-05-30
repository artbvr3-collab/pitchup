# bounded context: moderation

**Purpose.** User reports, admin actions (ban, role management, venue/match takedowns), admin dashboards.

**Core entities.** `AdminAction` (audit log — Layer 9a). `Report` (planned — Layer 9d).

**Key use cases.**
- `BanUserService` / `UnbanUserService` / `PromoteUserService` / `DemoteUserService` (Layer 9a — `/admin/users`).
- `FileReportService`, `HideMatchTextService`, `DeleteMatchService` (planned — Layer 9c/9d).

**Invariants.**
- Bans take effect on the next `requireAuth()` call (see `auth` context) — no live session kill.
- Admin-only endpoints call `requireAdmin()` in addition to `requireAuth()`.
- Ban reuses `match_lifecycle`'s `CancelMatchService` for the upcoming-match cascade with the canonical `SYSTEM_CANCEL_REASONS.organizerRemoved` string — identical public wording to self-delete (privacy).
- Self-modification guard (`target === actor`) + last-admin guard (`countActiveAdmins`) live in the services, never in the repository.

**External dependencies (ports).** `AdminActionRepository` (owned here). `UserRepository` (from `auth` — reads + the Layer 9a `setBanned` / `setAdmin` / `listForAdmin` writes). `MatchRepository` + `CancelMatchService` (from `match_lifecycle`, for the ban cascade). `ReportRepository` (planned — Layer 9d).

**Status.** Layer 9a shipped (admin user management + `admin_actions` audit). Venues / matches / reports tabs land in 9b–9d.

**Related docs.** `docs/spec/pitchup-spec-personal.md` → "/admin/*"; `docs/spec/pitchup-spec-global.md` → "Ban / account deletion", "Session invalidation".
