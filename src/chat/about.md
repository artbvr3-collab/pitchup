# chat — bounded context

Per-match group chat. One `ChatMessage` aggregate (UUID id, match_id, author_id, text 1..2000, created_at, deleted_at nullable for captain soft-delete). One repository port. Two write use cases (PostChatMessage / DeleteChatMessage) + one read assembler used by polling (`/api/matches/:id/state` — implemented in `match_lifecycle/application/match-state-service.ts` so polling stays a single cross-aggregate read; chat only owns persistence and per-message moderation).

Concurrency: chat writes **do NOT take `withMatchLock`** — exception per spec match.md §546 ("they don't touch slot/status/roster; timestamp ordering is sufficient"). Same exception family as `POST /matches` (create — no id yet to lock on).

Realtime transport is intentionally deferred to Layer 5.5 — see ROADMAP. The polling layer is the source of truth; Ably is an enhancement layered on top later, no port stub here yet (mirrors the Layer 7 Notification deferral pattern).

Author display name and `[Removed user]` fallback for banned/deleted authors is render-time resolution, not a column on `ChatMessage` (spec match.md §220 + AGENTS gotcha "Author resolution at render-time").

Related: docs/spec/pitchup-spec-match.md → "Tab Chat", docs/spec/pitchup-app-map.md → ChatMessage.
