# PITCHUP — Functional Spec (v3.1, split)

> Single source of truth for screens and features. We write code from these files.
> The spec is split into 4 files + this index. This file is a map, not content.

---

## File map

| File | Contents |
|---|---|
| [pitchup-spec-global.md](./pitchup-spec-global.md) | Global decisions, site map, entry pages (`/`, `/login`, `/welcome`), global components, error/empty pages, legal, rate-limits, CSRF |
| [pitchup-spec-discovery.md](./pitchup-spec-discovery.md) | `/games`, `/map` |
| [pitchup-spec-match.md](./pitchup-spec-match.md) | `/matches/:id` (all tabs, states, CTA bar, captain sheet), `/matches/:id/edit`, `/matches/new`, concurrency & locking |
| [pitchup-spec-personal.md](./pitchup-spec-personal.md) | `/my-matches`, `/chats`, `/me`, `/users/:id`, `/admin/*`, known gaps, out of scope for v1 |
| [pitchup-app-map.md](./pitchup-app-map.md) | Compact app map: roles, screens, navigation, ERD, cron, "what's available by status" — **derived** from the spec; spec wins on conflict. Audit checklist in the header. |

---

## Where to find a specific topic

### Auth / guest / onboarding
→ [global.md](./pitchup-spec-global.md): Authentication · Onboarding guard · Guest access · Ban / account deletion · `/welcome`

### Match data models
→ [global.md](./pitchup-spec-global.md): Match formats · Field surface · Field booking status · Match type · Total spots — hard cap on approve · Guests (+N) · Cover venue

### Notifications / polling sync
→ [global.md](./pitchup-spec-global.md): Notifications (email, in-app inbox, browser) · Polling sync (`GET /api/updates/state`)
→ [match.md](./pitchup-spec-match.md): Tab Chat (per-match poll `GET /api/matches/:id/state`)

### Match discovery
→ [discovery.md](./pitchup-spec-discovery.md): `/games` (list + chips) · `/map` (map + pins) · geolocation

### Match lifecycle
→ [match.md](./pitchup-spec-match.md): creation (`/matches/new`) · match page (`/matches/:id`) · editing (`/matches/:id/edit`) · Join/Leave/Cancel flows · Reject/Kick/Leave flows · states (Open/Full/In progress/Ended/Cancelled) · likes

### Personal screens
→ [personal.md](./pitchup-spec-personal.md): `/my-matches` (signed-in user's home) · `/chats` · `/me` · `/users/:id`

### Admin
→ [personal.md](./pitchup-spec-personal.md): `/admin/users` · `/admin/matches` · `/admin/venues` · `/admin/reports` · Hide text (content moderation)

### UI kit
→ [global.md](./pitchup-spec-global.md): TopBar · BottomNav · MatchCard · PlayerChip · Loading · Error/empty

### What we intentionally DON'T do / gaps
→ [personal.md](./pitchup-spec-personal.md): Known gaps · Out of scope for v1

---

## Rules for working with the spec

- **Cross-references within a file** — plain text ("see 'Field surface' above").
- **Cross-references between files** — plain text + link to the file ("see 'Field surface' in [global.md](./pitchup-spec-global.md)").
- **When editing** — look for an existing section first; don't duplicate. If a topic spans files, fix it in one place and add a short link in the others.
- **New sections** — add to the thematically appropriate file, not the index. Update the index only when adding a new top-level topic.
