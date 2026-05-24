# bounded context: match_lifecycle

**Purpose.** Match CRUD, join / approve / reject / leave / kick flows, status state machine (computed on-read), slot math, advisory-lock concurrency.

**Core entities (planned).** `Match`, `JoinRequest`, `Watch`, `Message` (chat). Value objects: `MatchId`, `MatchStatus`, `SlotMath`.

**Key use cases.** `CreateMatchService`, `JoinMatchService`, `ApproveRequestService`, `RejectRequestService`, `LeaveMatchService`, `KickPlayerService`, `CancelMatchService`.

**Invariants.**
- Captain cannot Join or Watch their own match (`captain_cannot_join` 400 — backend backstop, UI also hides).
- `Match.cover_id` snapshotted at INSERT; venue cover changes don't propagate.
- All mutating use cases wrap their work in `withMatchLock(matchId, …)`.

**External dependencies (ports, planned).** `MatchRepository`, `JoinRequestRepository`, `WatchRepository`, `MessageRepository`, `NotificationSender` (cross-context).

**Status.** Empty — populated starting at Layer 2 (read-only Discover), expanded through Layer 5.

**Related docs.** `docs/spec/pitchup-spec-match.md`, `docs/spec/pitchup-spec-global.md` → "Slot math", `docs/ARCHITECTURE.md` §8.
