# PITCHUP — Spec: global decisions

> Part of the spec. File map — [INDEX](./pitchup-spec-INDEX.md).
> ⚠ **After editing this file** — run the audit checklist in the header of [pitchup-app-map.md](./pitchup-app-map.md) and synchronously update the map if the checklist items are affected (stack, nav, TopBar, login, PWA, cron, lifecycle, entities).
> Here: global rules (auth, data, match model, notifications, polling sync, ban), site map, entry pages (`/`, `/login`, `/welcome`), global components, error/empty pages, legal.

---

## Global decisions

### Authentication
- **Google OAuth only** (Auth.js v5). No email/password at launch.
- After first sign-in → onboarding `/welcome`.
- **JWT lifetime: 333 days** (Auth.js v5 `session.maxAge = 333 * 24 * 60 * 60`). We don't do JWT refresh — the vast majority of sessions survive almost a year, users don't churn in that window. Browser hard cap on cookies is 400 days (Chrome, since 2022), 333 fits with room to spare. Forced invalidation on ban / account deletion is handled by checking `users.banned` / `users.deleted_at` on every request (see "Session invalidation" below) — the long lifetime doesn't hurt security, all active sessions are cut off simultaneously on the next request.
- **Session invalidation via `users.banned` / `users.deleted_at`.** Auth.js v5 in strategy=`jwt` stores the session in a signed cookie on the client — there is no server-side store, "deleting a session row" is impossible. Instead of a per-token blacklist, invalidation is driven by the user row itself. The middleware SELECT (which already runs on every protected request for the onboarding guard) fetches `id, banned, deleted_at` from `users` — no extra query. The same check runs in the `requireAuth()` helper on every protected API route handler. If `banned = true` → treat session as invalid → client redirects to `/login?error=banned`. If `deleted_at IS NOT NULL` → treat session as invalid → client redirects to `/login`. On ban or account deletion the row is updated in the same transaction (see "Ban / account deletion" below) — from that moment, the very next request or poll (≤15s) from any open tab of that user returns `401`. No extra table, no per-token tracking, no cron cleanup for this mechanism.

### User data
| Field | Source | Required | Visibility |
|---|---|---|---|
| Name | Google (editable) | Yes | Public |
| Avatar | Google (editable) | No | Public |
| Contact info | User-entered, free text | No | Public |
| Email | Google | Yes | Notifications only, not shown |
| Email notifications | User (toggle in /me, default on) | No | Account parameter only — not public |

> **Principle:** everything the player fills in their profile is public. Want more privacy — leave it blank. Email is the only private field, needed only for notifications.
> `email_notifications` — the only non-public parameter besides email. Controls sending of approve/kick/morning-reminder emails. Default: on.

> **Contact info** — one free-text field "How to reach me" (placeholder: "WhatsApp +420..., Telegram @username, Instagram..."). The player decides what to write, or whether to fill it at all. If empty — the field simply doesn't appear in the profile.
> Edited in the `Edit profile` modal on `/me` — alongside the name (one place for all public profile fields, no fragmentation).

### Unique login / username
**None.** Name + avatar only. Internally — UUID.

### Returning sign-in
If `users` already has a row for this `google_sub` — onboarding is complete, the user goes straight to `/my-matches`. If no row exists — middleware redirects to `/welcome` (see "Onboarding guard" below).

### Onboarding guard (middleware)

**Single source of truth — DB.** Middleware performs one SELECT on the `google_sub` index on every protected request: user row exists → onboarding complete → pass through; no row → user hasn't onboarded yet → redirect to `/welcome`. No `onboarding_completed` JWT claim, no `Auth.js update()`, no shell-row.

A signed-in user **without a user row in DB** is forcibly redirected to `/welcome` on any attempt to open any page other than those listed below. This covers the cases: deep-link `/matches/:id` right after OAuth, manually typing `/my-matches`, bookmarked `/me`.

**Allowed without redirect** (to avoid loops and to keep legal pages always accessible):
- `/welcome` — onboarding itself
- `/legal/terms`, `/legal/privacy` — legal must always be accessible
- `/api/auth/*` — Auth.js callbacks (sign-out, etc.)

**Everything else** (`/my-matches`, `/games`, `/map`, `/chats`, `/matches/*`, `/me`, `/users/*`, `/admin/*`) → `/welcome`. **callbackUrl is preserved through onboarding:** when redirecting to `/welcome`, middleware passes the original path as a query parameter (`/welcome?callbackUrl=/matches/abc123`) — parameter name is `callbackUrl` (Auth.js v5 native), the same key throughout the flow (don't confuse with `next`, which we don't use anywhere). After onboarding completes → if a valid `callbackUrl` exists (same-origin, passed Auth.js validation) → redirect there. Otherwise `/my-matches`. This covers the case "guest clicked Join on a match, went through OAuth + onboarding — returned to that match already signed in".

Edge case: `next` points to a page not appropriate for a new user (`/admin/*` — newcomer has `is_admin=false`) → standard middleware check after onboarding will redirect to `/my-matches`. No special logic needed.

**Guest (no session) on `/welcome`** → redirect to `/login` (without callbackUrl — standard sign-in). After OAuth:
- New user (no user row) → middleware sees missing row → `/welcome`
- Returning user (user row exists) → middleware passes → `/my-matches`

**Implementation.** Next.js middleware: checks for session in JWT (see claim set below), then checks for user row in DB. Three branches:
1. No session + path `/welcome` → `/login`
2. Session exists + no user row in DB + path not in allowlist → `/welcome?callbackUrl=<path>`
3. Session exists + user row exists + path `/welcome` → `/my-matches`

**What goes in the JWT — via explicit `jwt` callback.** Custom claims we put into the token and forward in the `session` callback:

| Claim | Source | Purpose |
|---|---|---|
| `googleSub` | `account.providerAccountId` on first sign-in (`provider === 'google'`) | Stable OAuth identifier for middleware user row lookup in DB. We don't rely on `token.sub` — that's Auth.js internal id, semantics can change between versions. |
| `email` | `profile.email` | Used in the `/welcome` INSERT (see below) and in email notifications. |
| `name` | `profile.name` | Pre-fill name on `/welcome` (including on tab reload without re-OAuth). After onboarding — for UI, while the user row hasn't been fetched yet. |
| `picture` | `profile.picture` | Pre-fill avatar on `/welcome`, same as `name`. |

Auth.js forwards them in the `session` callback as `session.googleSub`, `session.user.name`, `session.user.image`, `session.user.email`. Middleware reads `session.googleSub`. Pre-fill on `/welcome` reload — `session.user.name` / `session.user.image` (see "Reload state" in `/welcome` below).

> **`is_admin` not in JWT.** The `is_admin` flag is intentionally **not put in the token** — it is always read from DB by `user_id` (inside the `requireAdmin()` guard on admin endpoints and when rendering admin pages). This is by design: promote/demote/ban take effect **without re-login** — the moment of INSERT/UPDATE to `users.is_admin`, the very next request sees the new value. If `is_admin` were in the JWT — we'd either have to wait for token expiry or force re-login, neither of which is acceptable for real-time admin actions.

> **When we add a second provider** (e.g. email/password login or Apple) — `googleSub` will remain only for Google users; others will have a similar per-provider claim (`appleSub`, etc.) or a common `providerId` + `provider`. User row lookup will go by composite key `(provider, providerId)`. In v1 (Google only) — simplified to `googleSub`. See "Out of scope for v1" in [personal.md](./pitchup-spec-personal.md) → "Additional OAuth providers".

The DB adapter (`@auth/prisma-adapter`) **is not used** — it would insert a user row on the OAuth callback, before `/welcome`, which breaks the "user row is created only on `[Get started →]`" rule below.

**Cost of the extra SELECT.** One SELECT by primary-key index on every protected request, fetching `id, banned, deleted_at`. On Neon with pooler — 0.5-2ms. On a request that already does SSR + Tailwind + React rendering — unnoticeable. We used to keep `onboarding_completed` in a JWT claim to avoid this cost, but the price was 3 sync points (DB ↔ JWT ↔ client session via `Auth.js update()`) and potential redirect loops. Switched to "single source = DB". The `banned` / `deleted_at` checks piggyback on this same SELECT at no extra cost.

**User row is created only on onboarding completion** (tap `[Get started →]` on `/welcome`) — INSERT with `google_sub`, `email`, `name`, `avatar_url`, `contact_info=NULL`. No `onboarding_completed` flag, no shell-row on OAuth — until the user completes the flow, they don't exist in DB.

**Google profile — snapshot, not sync.** `name`, `avatar_url`, `email` are snapshotted into `users` row **at the moment of onboarding** and are **not synced with Google** afterward. If the user changed their avatar / name / email in their Google account after onboarding — PITCHUP keeps the old values. Rationale:
- `name` — editable on `/welcome` and in `/me → Edit profile`. Auto-overwriting from Google would erase user's edits. The user controls their name.
- `avatar_url` — in v1 there is no avatar editing in UI (see "Out of scope for v1" in [personal.md](./pitchup-spec-personal.md) — no file storage), but there's also no auto-update from Google. Most predictable behavior: what the user saw on onboarding — that's what stayed.
- `email` — used only for notifications. Snapshotted at onboarding. If the user changed their Google email, notifications keep going to the old one. This is a known gap (see "Known gaps" in [personal.md](./pitchup-spec-personal.md) — no UI handle to change email in v1). When added — it will be in `/me → Edit profile` alongside the name.

JWT claims (`googleSub`, `email`, `name`, `picture` — see "What goes in the JWT" above) continue to be pulled from the fresh OAuth payload on each sign-in — they're needed for `/welcome` reload pre-fill for users without a user row, not for updating existing rows. Middleware lookup goes by `googleSub`; the other claims for an existing user are not used.

**Consequences:**
- **Drop-off during onboarding** (closed tab): user row not created → on next OAuth, middleware redirects to `/welcome` again. Name/avatar pre-fill comes **from the Google OAuth payload** (`session.user.name`, `session.user.image`), not from DB. Fully equivalent — Google always returns these fields.
- **Sign-out from `/welcome`**: standard Auth.js sign-out, no DELETE — nothing to delete. On next sign-in — `/welcome` again with the same pre-filled data from Google.
- **Cron cleanup of "abandoned" accounts is not needed** — there are no shell-rows accumulating.

### Guest access (not signed in)

**Available without login (read-only):**
| Page | What the guest sees |
|---|---|
| `/` | Full landing |
| `/login` | Google OAuth button |
| `/legal/terms`, `/legal/privacy` | Static pages |
| `/games` | Match list. All filters work. Cards are tappable → `/matches/:id` |
| `/map` | Match map with pins. Same filters as `/games` (synced via URL). Tap on pin → bottom-sheet with MatchCard |
| `/matches/:id` | Full page: cover, details, Lineup (all players visible), Chat (read-only). CTA bar replaced with disabled `[Sign in to join]` |
| `/users/:id` | Public profile of any player (name, avatar, contact info) |

**Closed to guest — redirect to `/login`:**
- `/my-matches`, `/chats`, `/me` — personal pages
- `/matches/new`, `/matches/:id/edit` — actions require authorship
- `/admin/*` — among other things, also subject to `is_admin` check (`requireAdmin()`)
- Any POST/DELETE (Join, Leave, Like, Report, Chat send) — backend returns 401, frontend intercepts → `/login`

**Return after sign-in:**
- On redirect to `/login`, `?callbackUrl=<original path>` is saved in the query — standard Auth.js v5 parameter, same-origin validation and redirect after OAuth are built in.
- After successful OAuth:
  - **User already onboarded** (user row in DB) → standard Auth.js redirect to `callbackUrl`. If callbackUrl is empty → `/my-matches`.
  - **New user** (no user row in DB) → middleware intercepts any attempt to open anything other than `/welcome` and redirects to `/welcome?callbackUrl=<callbackUrl>`. After onboarding → redirect to `callbackUrl` if valid, otherwise `/my-matches`. More detail — in "Onboarding guard".
- Example 1 (existing user): guest on `/matches/abc123` taps `[Sign in to join]` → `/login?callbackUrl=/matches/abc123` → Google → `/matches/abc123` now signed in with an active Join button.
- Example 2 (new user): same flow → Google → middleware: no user row → `/welcome?callbackUrl=/matches/abc123` → onboarding → redirect to `/matches/abc123`.

**Visual differences for guests:**
- **TopBar** — logo on the left, `[Sign in]` button on the right (instead of 🔔). See "TopBar (guest)" below.
- **BottomNav** — shown with the same 5 tabs as for signed-in users, but `My matches`, `Chats`, `Me` are disabled (tap → `/login?callbackUrl=<that tab>`). Logo in TopBar leads to `/games`.
- **On `/matches/:id`** — CTA bar always shows disabled `[Sign in to join]` (instead of Join / Notify me / You're in). Tab Chat: input replaced with ghost block `[Sign in to chat]`. In `[⋯]` menu — only `Share` (Report match is hidden). Share works without login — it's a public link.
- **On `/users/:id`** — `[Report player]` in `[⋯]` menu **is visible to guests** (we don't hide the UI); tap → Sign-in modal (`"Sign in to report this player"`). After sign-in the user returns to the page and taps Report themselves.
- **On `/games` and `/map`** — `[+ New match]` button in the top bar is shown; tap → `/login?callbackUrl=/matches/new`.

**Sign-in triggers (where a guest encounters sign-in):**

Two different paths — **modal** for inline actions and **redirect to `/login`** for direct navigation to protected pages.

**Sign-in modal** (single component, used everywhere):
- Heading depends on context: "Sign in to join this match", "Sign in to chat", "Sign in to report", "Sign in to track your matches", etc.
- Sub-heading: "We only use Google. No passwords, takes 5 seconds."
- `[Continue with Google]` button — primary (full-width)
- `[Cancel]` button — ghost (or × in corner). Tap outside modal = cancel.
- After successful OAuth — return to the same page, **action is NOT auto-executed** (the user taps Join / Send / Report themselves after returning). This is intentional — we give them a chance to reconsider, we don't take unexpected actions.
- Technically, the OAuth flow is the same `/api/auth/signin/google?callbackUrl=<current_url>`, just the entry point is the modal rather than a separate page.

**Where the modal appears** (any inline action by a guest):
- Any `[Sign in to ...]` button in CTA bar / Chat input / TopBar
- Tap on Join pin on map / Join button from bottom-sheet preview
- `[Report player]` on `/users/:id` — guest tap opens Sign-in modal (button is visible; more detail — "Visual differences for guests" above). `[Report match]` on `/matches/:id` — **hidden** for guests (only `Share` remains in `[⋯]`).
- BottomNav: guest tap on disabled tab `My matches`, `Chats` or `Me` → `/login?callbackUrl=<that tab>`

**Where redirect to `/login?callbackUrl=...`** (deep-link / direct URL):
- Bookmark `/me`, `/my-matches`, `/chats`, `/matches/new`, `/admin/*` → `/login?callbackUrl=<same URL>`
- Backend 401 on a direct fetch (user lost session mid-session) → client redirects to `/login?callbackUrl=<current>`

### Viewport — mobile design only
**No separate desktop version in v1.** All UI is designed for mobile (target ~375px, iPhone-standard); on larger screens — same layout, centered in a `max-width: 375px` container. Sides — empty space (can be filled with a neutral background / illustration).

**What this means in practice:**
- No desktop-only elements: top-nav with links, sidebar on `/games` or `/admin`, 2-column layout on `/my-matches`. All of this **falls outside the spec** — ignore any mentions of "Desktop:" in sections below as outdated.
- BottomNav and TopBar are **always** sticky inside the central 375px container (at any screen size). This is not "desktop-specific" — it's one rule: everything sticks to the container edges. On larger screens there's a neutral background around the container.
- TopBar is the same at any screen size.
- Admin area — also scaled mobile. Tables fit at 480px via horizontal scroll in the table itself (overflow-x: auto). For admin this is a trade-off — we know admins typically sit at a desktop, but in v1 we don't duplicate layouts for 1-2 users with admin rights.

**Why:** players access from their phone (this is pickup football, not an enterprise tool). Desktop version for v1 is doubling work for a niche use case. When demand appears — we'll add responsive breakpoints as a known gap (see "Known gaps" in [personal.md](./pitchup-spec-personal.md)).

### UI language & i18n

**All UI strings in the spec are EN-only.** This covers labels, buttons, placeholders, toasts, error/empty page headings, email templates, `notification.body` text. Any quoted strings like `"Sign in to join this match"`, `"This user is no longer on PITCHUP."`, `"Not enough spots — increase Total or reject"` — are final English strings, not placeholders for translation.

**`next-intl` is wired in from day one** — all strings are wrapped in keys (`t('match.signInToJoin')` etc.), even if only an English namespace exists at launch. This avoids a refactor when adding CZ — only a second translations file needs to be added.

**Czech translation — v1.1+**, not in MVP. The Czech namespace is created in a separate release; the language switcher in `/me` appears at the same time. Until then `next-intl` serves only the `en` locale, without a UI selector. See "Known gaps" in [personal.md](./pitchup-spec-personal.md).

### Match formats
**Free-form player count.** The captain sets only Total spots. Price currency — Kč only (fixed).

### Timezones & date ranges

**Storage = UTC, display = Europe/Prague.** All timestamps in the DB (`Match.start_time`, `Notification.created_at`, etc.) are stored in UTC. The UI renders them in Europe/Prague regardless of the user's browser TZ. If the viewer's browser TZ differs from Prague — a `"Prague time"` label appears next to the rendered time.

**Canonical primitives.** Every "by day" query, picker bound, and horizon in the spec is expressed through these — implementations MUST funnel all Prague-day ↔ UTC conversions through one shared helper, not reinvent them per call site.

| Primitive | Definition |
|---|---|
| `today_prague()` | The current calendar date in `Europe/Prague` (a `YYYY-MM-DD`, not a timestamp). |
| `prague_day(d)` | For a Prague calendar date `d`, returns the half-open UTC interval `[utc_start, utc_end)` where `utc_start = midnight(d, Europe/Prague)` and `utc_end = midnight(d+1, Europe/Prague)`. Length ∈ {23h, 24h, 25h}: 23h on spring-forward (last Sunday of March), 25h on fall-back (last Sunday of October), 24h otherwise. **All "this day in Prague" filters use this — never `BETWEEN start_of_day_utc AND end_of_day_utc` computed naively.** |
| `prague_range(d1, d2)` | Convenience for an inclusive Prague-day range: `[prague_day(d1).utc_start, prague_day(d2).utc_end)`. |

**The 21-day horizon.** Used by the `/games` day picker, `/games?date=` validation, `/map` pins, `/map` venue sheet, `/map` Next chip, and the `/matches/new` date picker upper bound. Defined as `prague_range(today_prague(), today_prague() + 20)` — today inclusive through 20 days later inclusive, in Prague calendar days. A match is "in the horizon" iff `start_time ∈ this range`. `end_time` may spill past `utc_end` (the cap is on `start_time` only — see "Datetime picker" in [match.md](./pitchup-spec-match.md)).

**Time-of-day windows** (`Morning` / `Afternoon` / `Evening` filter on `/games` and `/map`): evaluated against `start_time` converted to Europe/Prague (duration is not considered). Window boundaries are defined in [discovery.md](./pitchup-spec-discovery.md) ("More filters"). The conversion uses the same TZ rule — no separate helper.

**Cron schedules.** Registered in TZ `Europe/Prague` (not UTC), so wall-clock 10:00 / 20:00 / 03:00 don't drift twice a year at DST. See "Cron jobs" in [match.md](./pitchup-spec-match.md).

**Why one helper, not inline math.** A naive `BETWEEN start_of_day_utc AND start_of_day_utc + INTERVAL '24 hours'` silently drops or duplicates an hour of matches on DST Sundays. Centralizing the conversion behind `prague_day` / `prague_range` is the only way to keep `/games`, `/map`, the creation guard, and reminders consistent across DST boundaries.

### Field surface (for filters and match card)

**Two surface options:** `Grass` (any grass — natural or artificial turf) and `Hard surface` (any hard — hardwood, concrete, asphalt, indoor hall). The key distinction — whether studs are allowed.

**Surface is tied to venue.** Admin sets surface(s) for each venue in `/admin/venues` — multi-select from two options. A venue can have both (e.g. outdoor grass + indoor hall).

**Backend tokens (for DB and API):** `grass` / `hard`. UI labels `Grass` / `Hard surface` — frontend only. In DB `Venue.surface` — `text[]` (see ERD in [app-map.md](./pitchup-app-map.md)), `Match.surface` — `text` (one of two tokens, captain picks from those available at the venue on creation). Membership validation — at app level (not Postgres enum, so adding a third surface in the future doesn't require a migration).

**Studs — at match level, not venue.** A match has a separate `studs_allowed` field (boolean), set by the captain on creation:
- **Hard surface** → toggle hidden, always `studs_allowed = false` (studs don't work on hardwood, nothing to discuss)
- **Grass** → toggle visible, captain chooses (`Studs allowed: Yes / No`)

**"Bring:" on match page and MatchCard:**
| Surface | studs_allowed | "Bring:" |
|---|---|---|
| Grass | Yes | Studs or rubber |
| Grass | No | Rubber only (no studs) |
| Hard surface | — | Indoor shoes / trainers |

**Icons on MatchCard:** 🌱 for Grass, 🏟️ for Hard surface. Adjacent mini-badge `Studs OK` / `No studs` if Grass.

**Exotica (sand, rooftop, gravel)** is not broken out as a separate type. Admin picks the closest Grass/Hard. If it genuinely becomes needed — we'll add `Other` later.

### Field booking status
Captain marks whether the field is booked:
- **Field booked** — field is definitely booked, match 100% happens → green badge `✓ Field booked`
- **Gathering players** — still gathering people, field booked later once we hit quorum → yellow badge `⚠ Field not yet booked`

Two states, not three: `field_booked = true/false`. "Gathering players" is simply `field_booked = false`.
Filter "Booked" shows only matches with `field_booked = true`. "Any" — all matches.
Visible on MatchCard and on the match page. Captain toggles it in `/matches/:id/edit` or at creation.

### Match type
Two creation scenarios:
1. **Open match** — captain is assembling everyone from scratch (default). Example: "need 14 people".
2. **Match with existing crew** — captain already has a team (friends), looking to fill remaining spots. Example: "we're 9, looking for +1".

> Not to be confused with the card state "Almost full" — that's for a match with ≤2 free slots (see "Match states" in [match.md](./pitchup-spec-match.md)).

Implementation: on creation the captain specifies **"Players coming with you"** — a list of friends' names who are definitely playing (not counting the captain; captain = their user account). Each name is free text (first name, e.g. `Pavel`). These entries are stored on the match as `captain_crew: string[]` — simply an array of strings, **not separate user rows in DB, not a stub table**. Each occupies one slot.

> **Terminology.** Canonical terms — **"stub player"** (one name-entry in the `captain_crew` array) and **"crew"** (the entire array of stubs, the `captain_crew` field). No other synonyms should appear in the spec: "crew member", "crew player", "named guest", "captain's +1" — these all refer to stub player. Pending/accepted real users in `JoinRequest` are not part of "crew".

Duplicate names are allowed (two Pavels — that's fine). Array length limit — `total_spots - 1` (captain also occupies a slot). Empty array = open match from scratch.

Displayed on card as:
- "9/10 · 1 spot left" — for crew with one open spot (1 captain + 8 crew + 1 open)
- "3/14 · 11 spots open" — for open match

In Lineup, these entries render as grey PlayerChips with name only — no avatar, no link to profile (tap → tooltip `"Not on app yet"`). See "Tab Lineup" in [match.md](./pitchup-spec-match.md).

If `captain_crew.length + 1 == total` → match is full immediately, only `[Notify me]` button is available.

**Crew ≠ guests.** Don't confuse:
- **Crew** = array of stub players in `captain_crew` (see terms above). List of named stub players set by the captain **at match creation**. Each stub = grey chip with name, one slot.
- `guest_count` — anonymous `+N` on any player's request (0..4, see "Guests (+N on join)" below). Have no names, rendered as `+N` badge on the owner's chip.

**What happens when a real friend submits Join.** Normal approve — no modals, no auto-detect, no name comparison. Captain taps `[✓]`, pending → accepted, +1 to counter. The match temporarily shows both entries (grey stub + colored real Pavel). If the captain wants to merge them — go to `[Edit match]` and remove the stub from the crew chip input. A visible action, no hidden "replacement magic". If the match is already full at the time of approve — `[✓]` is disabled (see "Total spots — hard cap on approve" below). More detail — in "Approve flow" in [match.md](./pitchup-spec-match.md).

### Total spots — hard cap on approve
`Total spots` on a match — **hard cap on accepting players**. The captain **cannot approve a request if the resulting `filled` would exceed `total`**.

- Backend in `POST /api/matches/:id/approve` checks `computeSlots({...match, accepted: [...accepted, request]}).filled <= capacity`. If not — returns `409 over_capacity`. Captain's UI mirrors this: `[✓]` button next to a pending player is **disabled** when `1 + request.guest_count > computeSlots(match).free`, with tooltip `"Not enough spots — increase Total or reject"`.
- Captain wants to accept the 12th player when total=10 — first `[Edit match] → Total spots [+]`, then approve. No "silent overshoot" through approve.
- For the player, UX block is unchanged: when `isFull`, the regular Join is hidden, only `[Notify me]` is shown.
- UI shows real numbers. "Full" badge — when `filled >= capacity`.

**Join API does NOT check free.** This is intentionally asymmetric with approve: pending **does not occupy a slot** (see "Slot math" — pending is not included in `filled`), so submitting a request on a full match is legitimate. Scenario: watching player, race with a parallel approve, or simply a player hoping the captain raises total — all should be able to create a pending. Hard cap fires on approve, no sooner.
- `POST /api/matches/:id/join` checks only `match.status === live` (not Cancelled/InProgress/Ended) and the absence of an active request from the same user (idempotency). Free is not compared.
- UI: when `isFull`, the regular `[Join match]` button is hidden (only `[Notify me]` is visible) — this is a **UX shortcut**, not a security measure. A watching player on a full match through `[Notify me]` won't enter pending (their CTA is informational "you'll be notified"), but if they somehow (old tab, direct curl) send a POST to Join — the request will be legitimately created and the captain will see it and decide.
- On a **non-live** match (`InProgress` / `Ended` / `Cancelled`) Join always returns `409 match_locked`. Same for matches with a past `start_time` still waiting for cron auto-reject — status is computed on-read, not from a DB flag (see "Match states" in [match.md](./pitchup-spec-match.md)).

**When overshoot (`filled > capacity`) is still possible:** only as a consequence of **Edit total ↓** (captain lowered total below current accepted — see constraints in `/matches/:id/edit` in [match.md](./pitchup-spec-match.md)) or races that the backend block rejects. Normal approve does not create overshoot.

### Guests (+N on join)
**Any match accepts requests with guests.** There is no separate match flag (like `Allow +1`) — it's always possible, captain decides at approve time.

- In the Join modal, the player sees **stepper "Bringing friends" 0..4** (default 0). One player can bring 0 to 4 anonymous guests. Limit of 4 — practical ceiling, at 6v5 that's already the edge of common sense.
- The request stores `guest_count` (integer 0..4). Total slots occupied: `1 + guest_count`.
- Captain in captain sheet / Tab Lineup sees pending as `Ivan Novak (+3)` if the player brought 3 guests. Tapping `[✓]` approves with all guests at once — guests cannot be trimmed separately. If `1 + guest_count > free` — `[✓]` is disabled, tooltip `"Not enough spots — increase Total or reject"` (see "Total spots — hard cap on approve" above). Captain chooses: reject, or raise total via `[Edit match]` and then approve.
- In Lineup, an accepted player is shown as one PlayerChip with a `+N` badge (if N > 0). Match slot counter includes guests: `Ivan +3` = 4 slots. The guests themselves are not rendered as separate chips.
- **Leave / Kick:** Ivan leaves or is kicked → all his slots are freed (1 + N). Guests are inseparable from their owner.
- **After accept, guest count cannot be changed.** Want fewer/more — Leave and re-apply. Intentional simplification.

> From earlier spec versions we removed the match field `Allow "+1"` and button `Join +1`. Don't confuse.

### Slot math

**Single formula for match occupancy.** Used everywhere slots are mentioned (MatchCard counter, approve validation, CTA bar isFull check, "Almost full" / "Full" badges, watching trigger on slot release, Edit total preview).

```
filled   = 1 (captain) + captain_crew.length + Σ(accepted JoinRequest: 1 + guest_count)
capacity = match.total_spots
free     = max(0, capacity - filled)
isFull   = filled >= capacity
```

**Convention:** everything that counts slots calls **one function** `computeSlots(match) → { filled, capacity, free, isFull }`. No local recalculations in components / API handlers / SQL expressions. This is the only way to guarantee UI, backend validation, and DB invariants stay in sync.

**Approve hard cap.** Backend on approve won't allow `filled > capacity` (see "Total spots — hard cap on approve" above). The formula correctly returns `free = 0` and `isFull = true` when `filled == capacity`, no negative numbers.

**Overshoot (`filled > capacity`)** in DB is possible in one case: captain/admin through Edit lowered `total_spots` below the current accepted count (if the frontend allowed it — see `/matches/:id/edit` in [match.md](./pitchup-spec-match.md), where the stepper by default **does not allow** setting below current accepted). In case such a record does appear (history, migration, manual DB intervention) — the formula returns `free = 0` and `isFull = true`, UI renders an honest `11/10 players` without crashing.

**What is NOT included in `filled`:** pending JoinRequests, watch flags, rejected/kicked/left records. Only accepted and crew.

### Notifications

**Three channels:** email, in-app inbox, and browser notifications (Notification API). Web Push (service worker, needed for iOS Safari and background notifications) is deferred to v1.1 along with PWA.

**Email — narrow channel, critical events for the user only:**
| Event | Recipient |
|---|---|
| ✓ Approved (your request was accepted) | player whose request it is |
| ✗ Kicked (you were removed from the match) | kicked player |
| 💬 Morning-of-match reminder | all accepted + match captain. **Two runs per day:** 10:00 Prague (matches today, `start_time >= now()`) · 20:00 Prague (matches tomorrow with `start_time` before 12:00). Schedules are registered in TZ **`Europe/Prague`, not UTC** — this is critical for DST: the transition to/from summer time must automatically shift the cron's UTC hour, otherwise in March and October the morning push will slip by an hour. More detail — in "Cron jobs" in [match.md](./pitchup-spec-match.md) |

That's all. No other emails in v1. Controlled by a single toggle "Email notifications" in `/me` (see Section NOTIFICATIONS in [personal.md](./pitchup-spec-personal.md)). Disabled — nothing arrives, user's own risk. Rejected pending and match cancelled are **not sent by email** — the player learns about them in the in-app inbox / on next app open.

**In-app inbox = Updates panel on 🔔 tap in TopBar.** There is no separate `/notifications` page in v1. The toggle doesn't disable it — inbox always works.
- **Red dot on 🔔** appears when there are unread items. No counter — exact count is visible inside the panel. Updated on the next `GET /api/updates/state` poll (see "Polling sync" below), regardless of the current page.
- **Updates panel:** bottom-sheet. Heading "Updates", list of up to 20 latest notifications in reverse chronological order. **Mark-as-read on open** = `UPDATE notification SET read_at = now() WHERE user_id = ? AND read_at IS NULL` — **without `LIMIT`**, ALL unread notifications of this user are marked read, including those that didn't fit in the top-20 (older than the 20th by position). This is intentional: red dot goes out completely, no "hidden unread". `[Show older]` / pagination in v1 **does not exist** — items past the 20th are not accessible to the user (only via storage migration or direct SQL). This is a **known gap** (see "Known gaps" in [personal.md](./pitchup-spec-personal.md)) — if feedback calls for it, we'll add infinite-scroll on the `(user_id, created_at DESC)` index.
- **Item structure:** icon by type (✓ approved / ✗ declined / 🚫 kicked / ⚠ cancelled / 🔄 updated / 💬 reminder / 🟢 spot opened) + one line of text + relative time ("2h ago"). Tap → goes to `/matches/:id`. Panel closes.
- **Events that go into inbox:**
  - approve / reject of a request
  - kick
  - match cancelled — **for accepted AND for pending** (pending also gets `match_cancelled` notification, body: "Your request was declined — match was cancelled"; see "`action` → `notification.type` mapping" in "Polling sync" below)
  - match details updated (for accepted, **material changes only** — `start_time`/`duration`/`venue`/`surface`/`studs_allowed`/`price`/`field_booked`; non-material `total_spots`/`captain_crew`/`description` — silent, see "Polling sync" below)
  - spot opened up (for watching — when a slot opened; and for captain **on Leave** — user left on their own, captain didn't know. On Kick and Edit total↑ captain initiated the slot release themselves — no push; see `notify watching` in [match.md](./pitchup-spec-match.md))
  - morning-of-match reminder (duplicated in both email and inbox)
- **Mark as read:** opening the panel = entire batch is read, red dot goes out. No "mark as unread" or "delete" in v1.
- **TTL:** 30 days. Older — auto-cleanup by cron (`Inbox TTL cleanup`, once daily, see cron table in [app-map.md](./pitchup-app-map.md)).
- **Empty state:** "No updates yet".

**Data model** (source of truth — ERD in [app-map.md](./pitchup-app-map.md), entity `Notification`):
- Table `notification(id, user_id, type, match_id, body, created_at, read_at)`. `type ∈ { approved, rejected, kicked, match_cancelled, match_updated, spot_opened, morning_reminder }`. `match_id` nullable for the future (for types without a match); in v1 all events are about a match, so always populated. `body` — ready-made text string ("Your request was declined — match was cancelled"), no client-side templates.
- **Index:** `(user_id, created_at DESC)` — query for Updates panel.
- **Red dot:** `EXISTS (notification WHERE user_id=? AND read_at IS NULL)`. Boolean, not a counter.
- **Mark-as-read:** on opening the Updates panel → `UPDATE notification SET read_at = now() WHERE user_id=? AND read_at IS NULL`. Other open tabs see the updated state (red dot gone) on their next `GET /api/updates/state` poll.
- **Writing new records:** all triggers (approve, reject, kick, cancel, edit, spot opened, morning reminder, admin actions) perform `INSERT notification(...)` **inside the same transaction** as the primary operation (see "Concurrency & locking" in [match.md](./pitchup-spec-match.md) — `notification` rows inside the transaction). After commit the row is available for the next `GET /api/updates/state` poll.
- **Deduplication:** not required in v1 — each event is written as a new row, even if the user received three identical "spot opened" in a row. Spam is controlled by design (watching is removed after the first push, edit details notifies only accepted, etc.), not DB constraints.

**Browser notifications (Notification API) — third channel, optional:**
- Works on desktop (Chrome, Firefox, Safari 16.4+) and Android Chrome **without PWA and without a service worker**. On iOS Safari without adding to Home Screen — doesn't work — we don't promise it in v1. Frontend detects the platform: on iOS the toggle is **hidden** (to avoid creating expectations). **iOS detection — by User Agent (`/iPhone|iPad|iPod/i.test(navigator.userAgent)`)** — all browsers on iOS (Chrome, Firefox, Edge, any) internally use the system WKWebView and inherit the same Notification API limitations as Safari, so checking the device is sufficient, not the engine/brand. No feature detection via `Notification in window` — on iOS it may be present but doesn't actually work.
- **When it fires:** `GET /api/updates/state` poll returns new notifications **AND** `document.hidden === true` (user is not looking at the tab). If the tab is active — in-app inbox already covers it, no need to duplicate.
- **Which events:** same as in-app inbox — approve, reject, kick, match cancelled, spot opened, match details updated. Morning reminder **is not shown as a browser notification** (email + in-app already cover it; a browser popup at 10am is excessive).
- **Permission flow:** tap toggle → if `Notification.permission === 'default'` → browser shows native prompt. Allowed → toggle on, save `browser_notifications: true` in **localStorage** (not in DB — the permission is browser-side, not account-side; different devices are independent). Blocked → toggle stays off + toast "Notifications blocked. Allow them in browser settings."
- **If the user later blocked in browser settings:** on the next `GET /api/updates/state` poll that returns new notifications → `new Notification()` throws → frontend catches → toggle flips back to off + toast "Browser notifications were blocked. Re-enable in browser settings."
- **Re-sync on `/me` mount.** On every mount of `/me`, the frontend compares `localStorage.browser_notifications` with the current `Notification.permission`:
  - `permission === 'denied'` → force `flag = false` (user may have blocked via browser site-settings between sessions; don't show stale `on` in UI)
  - `permission === 'granted'` AND `flag === true` → leave as is
  - `permission === 'granted'` AND `flag === false` → leave `false` (user intentionally turned off the toggle while having permission — this is a deliberate opt-out)
  - `permission === 'default'` → force `flag = false` (user reset permission in browser; next toggle enable will prompt again)
  This closes the desync "browser permission removed externally → UI toggle still shows `on`".
- **Notification payload:** title = match name or "PITCHUP", body = same text as in the in-app inbox item. Tap → `window.focus()` + navigate to `/matches/:id`.
- **Deduplication across tabs:** each tab polls independently and may detect the same new notification on the same poll cycle. Solution: `new Notification(title, { tag: \`notif:${notification.id}\`, body, ... })`. Browser collapses notifications with the same `tag` — the second (and subsequent) tab doesn't create a duplicate, it replaces the existing one without a new sound/popup (`renotify: false` by default). Zero coordination between tabs. On some older Safari / Linux DE there may be a brief flicker before collapse — acceptable for v1.

### Polling sync

**v1 uses polling instead of SSE.** No `EventSource`, no `LISTEN/NOTIFY`. Two lightweight poll endpoints replace the dual SSE channel architecture. SSE is deferred to v1.1 pending real usage data.

**Global poll — `GET /api/updates/state?since={ts}`**

Polled by the client every 15 seconds when `document.visibilityState === 'visible'`, every 60 seconds when hidden. Active on every signed-in page. Response shape:

```json
{
  "has_unread_notifications": true,
  "new_notifications": [{ "id", "type", "match_id", "body", "ts" }],
  "matches_changed": [{ "match_id", "my_status", "action" }]
}
```

`since` — ISO timestamp of the last successful poll. Backend returns only records with `created_at > since`. First call (no `since`, or after tab reload) → omit the parameter; backend returns full current state (last 20 notifications, current `my_status` for all active matches of this user). Backend (via `requireAuth()`) checks `users.banned` and `users.deleted_at` on every poll — if banned or deleted → `401` (see "Session invalidation" in Authentication above and "Auth" note below).

- `has_unread_notifications` → controls the red dot on 🔔.
- `new_notifications` → prepended to the Updates panel if open; browser notification fires if `document.hidden === true` (see "Browser notifications" above).
- `matches_changed` → re-renders `/my-matches` (Captain/Upcoming/Past sections recalculate, "Your next match" card updates if affected) and `/chats` (match card appears/disappears based on access change — e.g., user approved → chat becomes visible) for any `match_id` in the list. Also used by an open `/matches/:id` page to refresh match state — if `match_id` matches the current page, the page re-renders from the per-match poll (see below). **Note:** `/chats` card sort order (by latest message) and per-card unread dots are computed on-read from `ChatRead`/`ChatMessage` on each `/chats` page render, not driven by `matches_changed`. New chat messages do not produce a `matches_changed` entry — live chat updates are only available on the `/matches/:id` page via per-match poll.

**Per-match poll — `GET /api/matches/:id/state?since={ts}`**

Active only on the `/matches/:id` page. Every 15 seconds in foreground, 60 seconds in background. Requires a signed-in session (captain or accepted); guests get a static snapshot on page load, no polling. Response includes: new messages (since `since`), current lineup, match status, `deleted` flag.

Frontend merges new messages into the feed, re-renders Lineup if changed, updates match status badge.

- **`deleted: true`** — returned when the match has been hard-deleted by admin (`/admin/matches → [Delete]`). Frontend catches it → `router.push('/games')` + toast `"This match was removed"`. Different from `match_cancelled`: cancelled leaves the match page accessible; deleted removes the match from the DB entirely (page → 404, links from chats and inbox stop working).

**What does NOT update via polling:**
- MatchCard slot counters in `/games` / `/map` — on-read only (page load / pull-to-refresh). Too many matches, too frequent minor changes, low value.
- Another user's profile on `/users/:id` — static, rebuilt on navigation.
- Watching transitions (`none ↔ watching`) — the in-app notification ("🟢 A spot just opened") is the signal; `👀 Watching` card in Section Upcoming may remain stale until the next navigation to `/my-matches`. Intentional simplification, see "Watching logic" in [match.md](./pitchup-spec-match.md).

**Multi-tab consistency.** Each tab polls independently. Mark-as-read in one tab (`UPDATE notification SET read_at = now()`) → on the next poll all other tabs see `has_unread_notifications = false` → red dot goes out. No cross-tab event or `BroadcastChannel` needed. Same for chat read: opening Tab Chat UPSERTs `ChatRead.last_read_at`; on the next global poll other tabs receive the updated state.

**Auth on ban / account deletion.** On ban, `users.banned` is set to `true` in the same transaction. On account deletion, `users.deleted_at` is set to `now()` in the same transaction (soft delete — row stays for referential integrity). On the next poll or mutating request from any open tab of that user → `requireAuth()` does its regular SELECT and reads the updated `banned` / `deleted_at` → `401`. Client intercepts `401` and redirects: `banned` → `/login?error=banned` (banned screen); deleted → `/login`. No LISTEN/NOTIFY, no cross-process push, no extra table — the column check on every API call is the mechanism. Max delay before the user is cut off = one poll interval (≤15s). Until then the user may still receive poll responses — acceptable, not critical.

**`my_status` — UI-derived, not equal to `JoinRequest.status`.** The enum in the `matches_changed` payload is synthetic: derived from the user's role on the match, the existence of a JoinRequest and its `auto_reason`. Mapping:

| `my_status` | Derived from (on-read from DB) |
|---|---|
| `accepted` | `JoinRequest.status === 'accepted'` AND `match.cancelled_at IS NULL` |
| `pending` | `JoinRequest.status === 'pending'` |
| `declined` | `JoinRequest.status === 'rejected'` (any `auto_reason`, including NULL/`match_started`/`match_cancelled`) |
| `cancelled` | `JoinRequest.status === 'accepted'` AND `match.cancelled_at IS NOT NULL` — JoinRequest.status does not change on match cancel (pending → rejected, accepted — stays accepted); `cancelled` derives from match flag |
| `watching` | Watch record exists AND `JoinRequest.status ∉ {pending, accepted}` (including when JoinRequest is absent) |
| `none` | `JoinRequest.status ∈ {left, kicked, cancelled}` — user left the match / cancelled request / was kicked; CTA role `none`, can re-apply via `[Join match]` / `[Notify me]` (UPSERT UPDATE back to pending) OR no Watch record AND no JoinRequest at all |

> **`kicked` in payload.** `my_status = 'kicked'` exists **only in the `matches_changed` payload** as a signal for the frontend to play the Upcoming → Past card animation. On-read calculation on reload: `JoinRequest.status === 'kicked'` → `my_status = 'none'` (kicked user can re-apply). Section Past shows the kicked user with sub-label "You were removed" — this logic reads `JoinRequest.status` directly, not through `my_status`.
>
> **`cancelled` (match cancel) — JoinRequest for accepted players does not change.** Endpoint `POST /cancel` only does "mass-reject pending + UPDATE match.cancelled_at". Accepted JoinRequests stay as accepted. In UI, `my_status = 'cancelled'` is derived on-read from `match.cancelled_at IS NOT NULL` — not from a status row change. This is intentional: Section Past finds such users by `JoinRequest.status === 'accepted'` + `match.status === Cancelled`.

> **`rejected` (DB) vs `declined` (UI/payload) — single vocabulary.** Canonical mapping for the same state:
> - **DB:** `JoinRequest.status = 'rejected'` (one value, any `auto_reason` — captain reject, `match_started`, `match_cancelled`)
> - **UI label:** "Declined" / "Request declined" (in Section Past card, in notification body)
> - **Payload `my_status`:** `'declined'`
>
> No other synonyms. Don't write "rejected" in UI, don't write "declined" in DB schema, don't introduce `rejected_at` fields with UI semantics, etc. If a mismatch appears somewhere in the spec — that's a spec bug, not a choice to make.

**`action` — full enum.** The `action` field in `matches_changed` tells the frontend **what exactly happened**, to choose the animation and where to move the card. Allowed values:

| `action` | Trigger | `my_status` | What frontend does |
|---|---|---|---|
| `requested` | User tapped Join (POST /join) | `pending` | Add card to `/my-matches → Section Upcoming` with `Waiting…` badge. Emitted for other tabs of the user (their own tab updates immediately). |
| `request_cancelled` | User cancelled their own pending (POST /cancel-request) | `none` | Remove `Waiting…` card from Upcoming. Emitted for other tabs. |
| `accepted` | Captain approve (POST /approve) | `accepted` | Card redraws from `Waiting…` badge to `You're in ✓`. Appears in `/chats`. |
| `captain_rejected` | Captain reject pending (POST /reject) | `declined` | `Waiting…` card moves from Upcoming to Past as `"Request declined"`. |
| `match_started` | Cron auto-reject pending (start_time passed) | `declined` | Same as captain_rejected, but body text differs. See "Reject / Kick / Leave flows → Pending lives until `start_time`" in [match.md](./pitchup-spec-match.md). |
| `match_cancelled` | Captain cancel match (POST /cancel) | `cancelled` (if was accepted) / `declined` (if was pending) | Card → Past. For accepted — as `"Match cancelled"`, for pending — `"Request declined · match cancelled"`. |
| `left` | User left accepted (POST /leave) | `none` | Remove card from Upcoming (and from `/chats`). Emitted for other tabs. JoinRequest row **stays in DB** with `status='left'` — the user who left appears in Section Past as "You left". Re-apply after Leave — UPSERT UPDATE back to `pending`. |
| `kicked` | Captain kick (POST /kick) | `kicked` (UI-only enum) | Card moves from Upcoming (and from `/chats`). JoinRequest row **stays in DB** with `status='kicked'` — kicked user appears in Section Past as "You were removed". Re-apply after Kick — UPSERT UPDATE back to `pending`. |
| `match_updated` | Captain edit (PATCH /matches/:id) | same as current (role untouched — include the user's actual `my_status` in the payload) | Redraw card with new data (time not changing — venue, total, surface, description, price, field_booked); if was accepted and currently on the match page — also update Tab Details / Lineup counter. |
| `admin_deleted` | Admin hard-delete (DELETE /admin/matches/:id) | `none` (the JoinRequest row is gone too — there is no state to derive; `action: 'admin_deleted'` carries all UI semantics) | Remove card from all lists (Captain / Upcoming / Chats, including `👀 Watching` cards) **without moving to Past**. More detail — see "/admin/matches" in [personal.md](./pitchup-spec-personal.md). |

**`action` → `notification.type` mapping.** Each entry in `matches_changed` (where applicable) is accompanied by a row inserted into the `notification` table with the corresponding `type`. Relationship:

| `action` | `notification.type` | Comment |
|---|---|---|
| `accepted` | `approved` | |
| `captain_rejected` | `rejected` | body: "Your request was declined" |
| `match_started` (cron auto-reject pending) | `rejected` | body: "Match started — your request expired" |
| `kicked` | `kicked` | |
| `match_cancelled` (for accepted) | `match_cancelled` | body: "Match cancelled — [reason]" |
| `match_cancelled` (for pending) | `match_cancelled` | body: "Your request was declined — match was cancelled" |
| `admin_deleted` | — | **Notification is NOT created.** `matches_changed` entry is sent only for re-render of lists (remove cards from Captain/Upcoming/Chats). More detail — `/admin/matches → [Delete]` in [personal.md](./pitchup-spec-personal.md). |
| `match_updated` | `match_updated` | **Material changes only** — see below. body contains list of changed fields. |
| `spot_opened` (in-app notification only — **not** a `matches_changed` entry; watching transitions are excluded from `matches_changed`, see below) | `spot_opened` | for watching subscribers; arrives via `new_notifications` array in the poll response |
| `morning_reminder` (cron, not from an action) | `morning_reminder` | email + in-app (browser popup suppressed — see "Browser notifications" above) |
| `request_cancelled` (user cancelled their own pending) | — | **Does NOT create a notification**, polling only for tab sync |
| `left` (user left accepted) | — | Does NOT create a notification, polling only |

**`match_updated` — material vs non-material changes.** Not every captain Edit sends a notification:
- **Material changes (notify accepted):** `start_time`, `duration`, `venue_id`, `surface`, `studs_allowed`, `price`, `field_booked`. body: "Match updated: [list of changed fields in human-readable text]".
- **Non-material (silent):** `total_spots`, `captain_crew`, `description`. We update the match, include `match_id` in the next `matches_changed` poll response for card re-render, but do NOT create a `notification` row and do NOT write `match_updated` `notification.type`. Pending players are also unaffected.

More on material/non-material — see `/matches/:id/edit` in [match.md](./pitchup-spec-match.md).

**Watching transitions (`none ↔ watching`)** are **not included** in `matches_changed` in v1 — Watch is removed in the `notify watching` push notification to inbox, and `👀 Watching` cards in Upcoming may remain stale until the next `/my-matches` render. Intentional simplification, see "Watching logic" in [match.md](./pitchup-spec-match.md).

> **Notification text comes from `body` in the notification record, not from `my_status`.** `my_status` — UI-state enum for card transitions (Upcoming → Past, `Waiting…` badge → disappears, etc.); it collapses three different `auto_reason` values (`NULL` = captain reject, `match_started`, `match_cancelled`) into one `declined`. The specific wording ("Your request was declined" vs "Your request was declined — match has started" vs "Your request was declined — match was cancelled") lives in `notification.body`, written during `INSERT notification(...)` inside the source event's transaction. Frontend on new notification simply renders `body` as-is — no templates, no branching by `type`. The `action` field in `matches_changed` is used only for UI transitions (which animation to play in `/my-matches`), not for text — text is already in inbox.

### Ban / account deletion
Two scenarios for removing a user from the system:
- **Ban** (by admin) — permanent, lifted only by admin manually via `[Unban]` in `/admin/users`. User cannot sign in: after successful Google OAuth the backend drops the session (no session cookie is set), any `callbackUrl` is **ignored**, user is sent to `/login?error=banned`. On this page **all normal content is hidden** (Google button, password disclaimer, heading) — instead a central block is shown with an option to appeal (see "Banned state" in the `/login` section below). Profile on `/users/:id` → "This user is no longer on PITCHUP." (see below — unified text for banned and deleted, privacy considerations).
- **Delete account** (by the user from `/me` → Section ACCOUNT ACTIONS) — irreversible. `users.deleted_at` is set to `now()` (soft delete — the row stays in DB for referential integrity; hard delete would cascade-break chat history and match records). On `/users/:id` → "This user is no longer on PITCHUP." (same text as for banned). **Re-signing in with the same Google account after deletion:** the Auth.js `signIn` callback reads `deleted_at IS NOT NULL` → drops the session → redirects to `/login`. The account is permanently inaccessible.

> **Unified text on `/users/:id` for banned and deleted — "This user is no longer on PITCHUP."** Intentionally privacy-driven: we don't distinguish "banned by moderation" vs "deleted their own account" in public UI. An outside observer should not see whether a user was banned (that's moderation info, not for everyone). One text, one page behavior. Inside admin area `/admin/users` the distinction exists — it's needed for operations there.

**Consequences for matches** (same for ban and delete):
- **When it executes:** synchronously in the same transaction as the ban/delete (not on-read, not cron). By the time the admin sees "User banned" / user sees "Account deleted", all cascading cancellations and notifications are already queued. This matters — otherwise the match would stay open for a few more minutes and someone might Join.
- **Captain of upcoming matches** → all their upcoming matches (status Open/AlmostFull/Full, `start_time > now()`) are **auto-cancelled** with reason "Organizer account was removed". Players receive the standard cancellation notification; on the match page — standard cancelled banner. **InProgress matches are not touched** — they're already underway, the user is on the field; let them end normally. The captain's past matches are not touched — they're needed for history and likes.
- **Ghost match (InProgress without an active captain).** Edge case: captain deleted account / was banned during InProgress on their own match. Match lives on as normal: status will move to Ended on timer, chat keeps working for accepted, likes between accepted are available after Ended. **Captain sheet, Edit, Cancel, Shuffle teams** on a ghost match are opened by no one (sheet was only available to the captain, captain is gone; admin via `/admin/matches → [Edit]` / `[Cancel]` also won't proceed — `[Edit]` is disabled on InProgress/Ended, `[Cancel]` too). In Lineup `Organizer: [Removed user]`, grey default avatar, not tappable. Like modal after Ended shows roster without self — `[Removed user]` is not in the roster (no one to like), accepted players like each other normally. If there's only one accepted player and no one else — modal is empty, user closes it and moves on. Intentional simplification: the spec doesn't introduce "live captain handoff" for this rare case.
- **Accepted/pending/watching in other matches** → their records are deleted, slots are freed. Captain + watching players receive notification "A spot opened up" (if they were accepted). Pending — simply disappears. Watch subscription is deleted without notifying the captain. In Lineup and chat the name is replaced with "[Removed user]".
- **`[Removed user]` in UI — no additional info.** Wherever such a user is rendered (Tab Lineup, Tab Chat author, Like modal roster, mini-roster on MatchCard, OG preview): only default grey avatar + string `[Removed user]` (not tappable, tap to `/users/:id` is absent — 404 there). No name, contact info, likes counter `👍 N`, Captain badge, `+N guests` badge, tooltips. This is intentional: the profile no longer exists, any details are noise and a source of confusion. Likes stay in DB (for integrity of match history involving this user), but UI does not display them under `[Removed user]`.
- **Chat messages** — stay (otherwise history breaks). Author name → "[Removed user]", avatar → default. **Author is resolved at render-time**, not write-time: on every chat render, backend joins `ChatMessage.author_id → users` and checks `banned = true` or `deleted_at IS NOT NULL`. So messages from a user who was active at send time and was banned/deleted later render as `[Removed user]` retroactively — without migrating old records and without denormalizing `author_name_snapshot` into `ChatMessage`. Tapping the author in chat `[Removed user]` is **disabled** (overrides the general rule "tap on chat author → `/users/:id`" from Tab Chat in [match.md](./pitchup-spec-match.md) — nowhere to go, `/users/:id` would return 404 / banned screen).
- **Likes from/to this user** — likes from them are deleted. Likes to them remain in DB (they're on the match, not the user), but are not shown in UI under `[Removed user]` (see above).
- **Watch records** (the "Notify me" flag on full matches, see [match.md](./pitchup-spec-match.md)) — all watch subscriptions of the user are deleted in the same transaction, **without notifying the captains** of those matches. Watch is an anonymous flag; its disappearance is not an event (symmetrically with "Watching logic" in [match.md](./pitchup-spec-match.md), where Watch is removed on join/leave/cancel without noise). If the match was full and this user's watch was the only one — no one but them would have known anyway.
- **Writing to other chats** — banned/deleted user cannot send new messages. `POST /api/matches/:id/messages` is blocked by **two independent checks**: (1) `users.banned = false AND users.deleted_at IS NULL` (from `requireAuth()`) — blocks banned or soft-deleted user; (2) presence of accepted `JoinRequest` OR captain role on the match — redundant backstop for soft-deleted users (their accepted records are deleted in the same transaction, the captain flag is reset as part of auto-cancel of their own upcoming matches). Both checks independently return `403` — double block, not one. Old messages stay with author `[Removed user]` (see above), but no new ones from this account will appear in chat.
- **Captain tools for a banned captain.** If a user has `is_captain` on some match and also `banned = true` (rare but possible case: ghost match InProgress where captain was banned while the match is already running — see "Ghost match" above), any captain-mutating endpoints (`POST /approve`, `POST /reject`, `POST /kick`, `PATCH /matches/:id`, `POST /cancel`, `DELETE /api/matches/:id/messages/:msg_id`) are blocked with `403 forbidden` by the same `users.banned = false` check. Captain sheet / inline `[Delete]` / `[Edit match]` are already inaccessible to this user via UI (`401` on the next poll will close their session — `requireAuth()` reads `banned = true`, see "Session invalidation" in Authentication above), but backend backstop is needed against any open tabs with cached DOM or direct curl requests. Chat moderation in a ghost match of a banned captain falls to the admin at the match level — `[Hide text ▾]` in `/admin/matches` for description / cancel_reason, or `[Delete]` (hard delete of match) for illegitimate cases. Per-message moderation in a banned captain's chat is not possible in v1 (see "Known gaps" in [personal.md](./pitchup-spec-personal.md)).
- **Open tabs on ban/delete** — on the next poll or mutating request from any open tab of the banned/deleted user, `requireAuth()` reads `users.banned` / `users.deleted_at` in its regular SELECT and returns `401`. Client intercepts `401` and redirects: banned → `/login?error=banned` (banned screen); deleted → `/login`. Max window before cut-off = one poll interval (≤15s) — acceptable, not critical.

On **unban** the profile and matches **are not restored** — only the ability to sign in again. They create a new profile = goes through the normal onboarding flow? No, the profile remains as-is (name/avatar/contact info), the `banned` flag is simply lifted. Matches that were cancelled — are not restored.

**`is_admin` is preserved on ban.** The `is_admin` flag **is not reset** on ban — it lives independently of `banned`. This matters for last-admin guard and audit logic: the active admin counter uses the predicate `is_admin = true AND banned = false`, and a banned admin is not counted (see "Admin role management & safety" in [personal.md](./pitchup-spec-personal.md) — `count(is_admin=true, banned=false)`). On unban, the flag returns to active status automatically along with the rights. If an admin needs to be permanently demoted — that's a **separate operation** (`[Demote to user]` in `/admin/users`), and it has its own last-admin predicate.

### First-admin bootstrap
`/welcome` always inserts `is_admin = false`, and `[Promote to admin]` is only available from `/admin/users` — i.e. to an existing admin. Chicken-and-egg. Solution for v1: the first admin is set **manually in DB** once after deploy:

```sql
UPDATE users SET is_admin = true WHERE email = '<owner-email>';
```

No ENV flags "first sign-in = admin", no seed scripts, no secret `/bootstrap` route — all of these are channels for accidental escalations. From that point admins are created via `[Promote to admin]` in `/admin/users` (see [personal.md](./pitchup-spec-personal.md)). Protection against losing the last admin is described there in "Admin role management & safety".

### Text field validation & sanitization

All user-facing text fields — plain text, not rich text/HTML.

**Backend rules (on every INSERT/UPDATE):**
- `.trim()` — all string fields
- `.normalize('NFC')` — Unicode normalization, prevents duplicates of "identical" strings
- Max length check → `400 {field}_too_long`
- `captain_crew`: additionally strip empty strings from array after trim

**Limits:**

| Field | Max length |
|---|---|
| `captain_crew` — one name | 30 chars |
| `description` (match) | 2000 chars |
| Chat message | 500 chars |
| `cancel_reason` | 200 chars |
| Report comment | 500 chars |
| Contact info | 200 chars |

**XSS:**
React JSX automatically escapes everything in `{text}` — we don't use `dangerouslySetInnerHTML` anywhere without sanitize. The only exception: **Contact info** — links in the profile are rendered as clickable (`<a href>`). Allowed schemes: `http`, `https`, `mailto`, `tel`. WhatsApp links use `https://wa.me/` and are covered by the `https` scheme — no separate `whatsapp://` scheme (deep link doesn't work on desktop). Everything else (`javascript:`, `data:`, `tg:`, `whatsapp:`, etc.) — stripped, rendered as plain text without `<a>`. Telegram links via `https://t.me/username` (`tg://` scheme is unstable). `tel:+420...` — working scheme on mobile (tap → system dialer) and desktop (handler configured by OS, usually Skype/FaceTime).

**Match description, chat messages, cancel_reason, report comment, captain_crew** — rendered as **plain text**. URLs inside them are **not converted to `<a href>`** — even if the captain wrote `https://goo.gl/maps/...` in description, the link stays as text, user copies it manually. Intentional: reduces attack surface (one sanitization path for everything except Contact info), reduces spam-link noise in the public feed and chat. If the captain needs a map/link to venue — that's an admin field (`venue.google_maps_url`), rendered as a separate `[Open map ↗]` button on the match page.

**On frontend:**
- Char counter + disable submit when limit exceeded (UX).
- Backend is the single source of truth: frontend limits duplicate server logic for convenience, not instead of it.

### CSRF / same-origin

**All mutating endpoints** (`POST`, `PATCH`, `DELETE` under `/api/*`, except `/api/auth/*` which is covered by Auth.js) check one of:
1. Auth.js CSRF token (for classic form submissions — we barely have those, but it's supported).
2. **Same-origin check** — `Origin` header or `Sec-Fetch-Site: same-origin`. Auth.js v5 session lives in an http-only secure `SameSite=Lax` cookie — this already blocks cross-site `POST` from browser (cookie won't be sent). Server-side backstop: middleware on `/api/*` compares `Origin` against **`ALLOWED_ORIGINS` env variable** (CSV list). Prod: `pitchup.online`. Staging/dev: corresponding domains (e.g. `staging.pitchup.online`, `localhost:3000`). `Origin: null` (same-origin fetch without header) — allowed. Mismatch → `403 csrf_check_failed`.

`/api/auth/*` (Auth.js callbacks) is protected by built-in state-param and nonce — no separate checks.

`GET` endpoints are not subject to CSRF checks (by definition — no state can be changed).

> **Why not a CSRF token on every mutating fetch.** SameSite=Lax + Origin check closes 99% of real CSRF vectors and doesn't require spreading tokens across the frontend (we barely have forms, everything goes through fetch with session cookie). If feedback reveals a gap — we'll add double-submit cookie pattern; not doing it in v1.

### Rate limiting

All mutating endpoints apply per-user rate limits (buckets in Redis / Postgres advisory-counters — implementation detail). Goal — not security (harassment is handled via `/admin/users → [Ban]`), but protection against accidental bot loops and spam clicks. Spam protection in a product sense (repeated requests, chat spam) lives in the flow rules above.

| Endpoint | Limit | Window | On what |
|---|---|---|---|
| `POST /api/matches/:id/messages` | 10 | 1 minute | Per (user, match) — can't flood a single chat |
| `POST /api/reports` | 10 | 24 hours | Per user — total across matches + players. Backend deduplicates repeat reports on the same object (see "Submission modal" in [personal.md](./pitchup-spec-personal.md)); limit closes spam on different objects |
| `POST /api/matches/:id/join` | 5 | 1 hour | Per (user, match) — closes the Join → Cancel-request → Join loop (can't "spam ping captain" from pending section even without approve, see "Reject / Kick / Leave flows" in [match.md](./pitchup-spec-match.md)) |
| `POST /api/matches/:id/watch` | 5 | 1 hour | Per (user, match) — closes Notify-me / Stop-watching ping-pong |
| `POST /api/matches` | 10 | 24 hours | Per user — match creation |
| `POST /api/matches/:id/likes` | 30 | 1 minute | Per user — bulk likes in modal (30 per minute is enough for a 22+ roster; backend is idempotent via UNIQUE anyway) |
| `DELETE /api/me` | 1 | 5 minutes | Per user — protection against accidental double-click and automated abuse on a compromised account (one compromising click should not instantly burn all appeal options through a ban-unban-delete loop) |

**What is NOT rate-limited in v1:**
- `POST /approve`, `POST /reject`, `POST /kick`, `POST /cancel` (captain-only, trusted — if the captain spams they're breaking their own match)
- `DELETE /join`, `DELETE /watch` (idempotent, create nothing)
- `PATCH /me`, `PATCH /matches/:id` (user only harms themselves, not critical)
- `POST /api/auth/*` (Auth.js has built-in OAuth callback rate limiting)

**Response on limit exceeded:** `429 rate_limited` + header `Retry-After: <seconds>`. Frontend: toast `"You're going too fast. Try again in a minute."` The action button is not permanently blocked — the next tap after `Retry-After` seconds goes through.

### Cover venue
Each venue has a **cover** — a pre-made illustration (gradient + icon), not a real photo. This greatly simplifies the admin area: no file storage needed, no copyright questions, everything looks decent out of the box.

- The codebase contains a palette of **~10-12 covers** (SVG / CSS-gradient + football/ball/stadium/... icon). Each has an id (slug).
- Venue model has field `cover_id` (`VARCHAR(40)`, **not a Postgres enum** — membership validation against the palette is done at app level, so adding a new cover doesn't require a DB migration). When adding a venue in `/admin/venues`, admin selects one from the palette. **Default — deterministically by `venue.id` (uuid)** via explicit formula:

```js
cover_id = covers[parseInt(venue.id.replaceAll('-', '').slice(0, 8), 16) % covers.length]
```

This guarantees: (1) the same venue always gets the same cover (UI stability), (2) distribution is approximately uniform across the palette (the first 8 hex chars of a uuid are high-entropy random), (3) the formula is clean and reproducible in any environment (frontend / backend / SQL view) without an additional lookup table.
- Used in:
  - Hero on `/matches/:id` (16:9, full-width)
  - MatchCard (80×80 rounded, mini version)
- The same `cover_id` is used for both hero and card — rendered on frontend.
- **`Match.cover_id` — snapshot of `venue.cover_id` at INSERT time** (denormalization, not a JOIN on read). When `venue.cover_id` changes in `/admin/venues`, already-created matches **are not updated** — past and future matches keep the cover from when the captain created them. Reasons: (1) history is not rewritten retroactively; (2) captain created the match with a specific visual, unexpected cover change breaks recognizability in chat/preview/MatchCard; (3) on the match page `cover_id` comes directly from `Match`, one fewer field depending on venue row freshness (though `venue` is still JOINed for `name`/`address`). INSERT logic: `Match.cover_id := (SELECT cover_id FROM venue WHERE id = $venue_id)` in the same transaction as match creation — field NOT NULL, no fallback (if venue has no cover_id — that's an invariant violated in `/admin/venues`, we fail INSERT with an explicit error).

---

## Site map

> **Legend:** in **GUEST-READABLE** section, guest reads the page but any action button (Join, Chat send, Report) is disabled with `[Sign in to ...]` — tap → `/login?callbackUrl=<from>`. More detail in "Guest access" above.

```
PUBLIC (fully open)
├── /                          → Landing
├── /login                     → Google OAuth
└── /legal/{terms,privacy}

GUEST-READABLE (guest reads, actions → /login?callbackUrl=…)
├── /games                     → match list (formerly /discover list view)
├── /map                       → match map (formerly /discover map view)
├── /matches/:id               → match page (Chat read-only, CTA disabled)
└── /users/:id                 → player public profile

AUTH-ONLY (no login → /login?callbackUrl=…)
├── /my-matches                → home: likes + captain + upcoming + past
│                                in one scroll, no sub-tabs
├── /chats                     → list of match chats (accepted/captain), unread dots
├── /matches/new               → create match (3-step wizard)
├── /matches/:id/edit          → edit (captain/admin only)
└── /me                        → profile + settings + legal + sign out + delete account
                                  (all on one page, no separate /me/settings)

ONBOARDING (one-shot after first login)
└── /welcome                   → guard in both directions (see "Onboarding guard"):
                                  • user row exists in DB → redirect to /my-matches
                                  • user row missing + attempt to open any
                                    other page → redirect to /welcome
    └── One step: confirm name and avatar (pre-filled from Google,
                   name editable, avatar read-only)

ADMIN (is_admin=true; /admin → redirect to /admin/users)
                                 non-admin (is_admin=false) → silent redirect to /my-matches
                                   (no 403 page — don't reveal admin area existence)
                                 guest → /login?callbackUrl=/admin → after OAuth
                                   if not admin → /my-matches
└── /admin
    ├── /admin/users           → user management
    ├── /admin/matches         → match moderation
    ├── /admin/venues          → venue directory (CRUD)
    └── /admin/reports         → reports on matches and players

LEGACY REDIRECTS (308 Permanent Redirect — for old links from emails/chats/bookmarks)
├── /home          → /my-matches
├── /discover      → /games
├── /discover?view=map → /map
└── /me/settings   → /me
```

---

## Entry pages

### `/` — Landing

**Goal:** convince the visitor to sign up.

**Blocks top to bottom:**
1. **Hero:** heading "Pickup football in Prague." + sub-heading "Create a match, fill the spots, play tonight." + buttons `[Sign in with Google]` (primary) and `[Browse matches →]` (ghost/secondary, below primary) — gives guest a way into the product without signing in
2. **3 cards:** "Create a match" / "Join a match" / "Play tonight" — icon + 1 line description
3. **Footer:** links Terms · Privacy · contact

**Buttons:**
| Element | Action |
|---|---|
| Sign in with Google | → /login → Google OAuth → /welcome or /my-matches |
| Browse matches | → /games (as guest) |
| Terms / Privacy | → /legal/terms · /legal/privacy |

**States:**
- If already signed in → redirect to /my-matches

**OG meta tags** (for sharing the site itself in chats):
- `<title>`: `"PITCHUP — Pickup football in Prague"`
- `<meta name="description">`: `"Create a match, fill the spots, play tonight."`
- `<meta property="og:title">`: `"PITCHUP — Pickup football in Prague"`
- `<meta property="og:description">`: `"Create a match, fill the spots, play tonight."`
- `<meta property="og:url">`: `https://pitchup.online/`
- `<meta property="og:type">`: `"website"`
- `<meta property="og:image">`: `/og/landing.png` (1200×630, same brand style as `/og/match-default.png`, can be the same image)
- `<meta name="twitter:card">`: `"summary_large_image"`

This same base set of tags — fallback on any screen that doesn't have more specific OG (e.g. `/legal/*`, `/users/:id` without specifics).

---

### `/login`

Auth.js v5 Google OAuth. Minimal page — just a Google button. No email/password.

**Disclaimer under the Google button.** One block in small grey text (2 lines), addresses "the paranoid user who's afraid to register with email":
> *We use Google sign-in, so we never see or store your password — your account stays under your control.*
> *Your email is used only for match notifications (approve, kick, morning reminder). It's never shown to other users or shared. If you lose access — recover through Google.*

Static text, no links (privacy policy is linked separately in footer `/legal/*`). No "I agree" checkboxes — Google OAuth and its own consent screen cover the legal side.

**If already signed in** → redirect to `callbackUrl` (if present and passed Auth.js same-origin validation) or to `/my-matches`. Google button is not shown.

**Banned state (`?error=banned`).** When a banned user completed OAuth, backend dropped the session and redirected here (see "Ban / account deletion" above). On this page **everything is hidden** — Google button, password disclaimer, heading. Instead — a central block:
- Heading: "Account banned"
- Body: "Your PITCHUP account has been banned. If you think this is a mistake, you can appeal — describe the situation and we'll review."
- `[Appeal — email us]` button — primary → `mailto:appeals@pitchup.online?subject=Account appeal` (opens mail client with pre-filled subject). On devices without a default mail handler the link still works — the mail client handles it. **Appeals in v1 are handled manually through Google Workspace alias `appeals@pitchup.online`. Admin UI for appeals (queue, statuses, replies from UI) — not in v1**, see "Known gaps" in [personal.md](./pitchup-spec-personal.md).
- No other paths: no Google button, no link to `/games` as guest, no links to `/legal/*` in the visible area. Footer (Terms / Privacy) — kept, it's legally required navigation and provides no bypass (legal pages are read-only). TopBar — no `[Sign in]`, logo only; tapping logo does nothing (or leads to `/` landing — from there `[Sign in with Google]` → banned → back here again). Effectively, the banned user has nowhere to go except to appeal.
- Implementation: `/login` page checks `searchParams.get('error')` — if `'banned'`, renders **only** the banned block (early return from component). All other `/login` content is not rendered at all, not just hidden with CSS.

**Other error states.** Auth.js v5 on OAuth flow errors redirects to `/login?error=<value>`. Full list of values — in Auth.js docs, but in product UI we map them to two groups:

| `?error=` | When | What we show |
|---|---|---|
| `banned` | Our backend drops session for banned user (see "Ban / account deletion" above) | Banned screen (replaces the page entirely, see "Banned state" above) |
| `AccessDenied` | User closed Google consent screen / declined to grant permissions / OAuth provider returned refusal | Neutral blue alert above Google button: **"Sign-in cancelled. Try again when you're ready."** No alarm — user cancelled themselves, that's normal. |
| `OAuthSignin` / `OAuthCallback` / `Callback` / `Verification` / `Configuration` / any other | Real technical error (OAuth callback failed, provider issues, misconfiguration) | Yellow alert above button: **"Sign-in failed. Try again."** No details — they're in server logs, won't help the user. |
| value not in the list above and not `banned` | Auth.js updated and introduced a new code | Same yellow "Sign-in failed. Try again." (fallback) |

In all cases except `banned` — **Google button stays active**, user can retry on this page. Alert is dismissed with × (in the alert's top right corner) or automatically on next tap on Google. Implementation: on `/login` page check `searchParams.get('error')`, branch `'banned'` renders banned screen as early return (see "Banned state" above), all other values go through mapping above and render alert + normal page with Google button.

---

### `/welcome` — Onboarding (1 step)

Shown only once — after first Google sign-in. Protected by bidirectional middleware guard (see "Onboarding guard" above): those who completed it don't land here; those who haven't can't leave it except to `/legal/*` and `/api/auth/*`.

**TopBar:** logo on left, ghost link `Sign out` on right (instead of 🔔). Covers the case "signed in, changed mind, want to sign out". Tap → standard Auth.js sign-out (`/api/auth/signout`, in middleware allowlist). **No DELETE from DB** — at this point user row hasn't been created yet (it's created only on `[Get started →]`), nothing to delete. OAuth session is cleared, user exits to `/login` / `/`. On next Google sign-in — back to `/welcome` with pre-filled data from Google OAuth payload.

**BottomNav:** **hidden on `/welcome` entirely.** User hasn't completed onboarding — tab navigation is pointless: BottomNav taps would trigger redirects back to `/welcome` via middleware guard. The only exits from this page — `[Get started →]` or `Sign out` in TopBar.

**Content — one screen, confirm name and avatar:**
- Heading "Welcome to PITCHUP".
- Avatar (preview from Google, read-only in v1 — no custom photo upload, no file storage; see "Out of scope for v1" in [personal.md](./pitchup-spec-personal.md)).
- Name field (pre-filled from Google, editable; in case "don't want to expose full name from Google account" — can be changed).
- `[Get started →]` button — primary.
- Caption at the bottom in small grey text (two lines):
  > *You can change your name and contact info later in your profile.*
  > *Your email stays private — used only for match notifications, never shown to others. We don't store your password (Google handles login).*

**After tapping `[Get started →]`:**
- Backend: `INSERT INTO users (google_sub, email, name, avatar_url, contact_info, email_notifications, is_admin, banned) VALUES (?, ?, ?, ?, NULL, true, false, false)`. This is the **first and only** DB record for this user — until this point they don't exist in `users` (see "Onboarding guard" above). Schema: `users.id uuid PRIMARY KEY DEFAULT gen_random_uuid()` (id auto-generated), `users.google_sub TEXT UNIQUE NOT NULL` — uniqueness enforced by DB, not application. Promotion to admin — only via `/admin/users → [Promote to admin]` by an existing admin; first admin is set manually in DB (see "First-admin bootstrap" below).
- **Race with parallel tab** (user opened `/welcome` in two tabs and tapped `[Get started →]` almost simultaneously): INSERT is done as `INSERT INTO users (...) VALUES (...) ON CONFLICT (google_sub) DO NOTHING RETURNING id`. If RETURNING is empty (other tab got there first) — fall back to `SELECT id FROM users WHERE google_sub = ?` and proceed with the success path using the found id. UNIQUE index on `google_sub` — the only protection against duplicate rows; no advisory locks.
- Frontend: after successful INSERT — `router.push(callbackUrl ?? '/my-matches')`. **No `Auth.js update()` needed**: middleware on the next request does its normal SELECT and sees the newly created user row.
- Redirect:
  - If URL contained `?callbackUrl=<path>` and path passed same-origin validation → redirect to `callbackUrl`
  - Otherwise → `/my-matches`
- **If INSERT fails** (DB / network error / unique constraint race with parallel tab) → user stays on screen, toast "Something went wrong. Try again." `[Get started →]` is active again. On unique-constraint specifically (double submit) — backend catches the error, returns 200 (idempotent), frontend proceeds on success path. No separate error screens.

> **Reload state.** Tab reload on `/welcome` = same screen, name/avatar pre-filled **from Google OAuth payload** (`session.user.name`, `session.user.image` — Auth.js v5 puts them there from the last successful OAuth). If the user had edited the name in the input before reload — changes are lost (saved nowhere). Accepted — onboarding is one screen, refilling is not painful. For `/matches/new`: same rule — tab reload = start from step 1, everything from scratch. If complaints arise — we'll add localStorage draft. See "Known gaps" in [personal.md](./pitchup-spec-personal.md).

---

## Global components

### TopBar (authenticated)
Logo on left, 🔔 on right. Red dot if there are unread items. Tap → Updates panel (see "Notifications" above). No avatar in TopBar. Own profile — via BottomNav `Me`. **No settings gear anymore** — all settings and Sign out / Delete account live as menu items on `/me` page (see [personal.md](./pitchup-spec-personal.md)).

### TopBar (guest)
Logo on left, `[Sign in]` button on right. Tap on logo → `/games` (not landing — guest has already arrived, no reason to send them back to landing; exception: on `/` the logo leads to `/`, to avoid `current = target`). Used on `/`, `/games`, `/map`, `/matches/:id`, `/users/:id`, `/legal/*` for non-signed-in users. BottomNav for guests is shown with the same 5 tabs as for signed-in users, but `My matches`, `Chats`, and `Me` are marked **disabled** (grey icon, tap → `/login?callbackUrl=<that tab>`). This lets the guest see the app's structure and invites sign-in rather than hiding half the UI.

> **Naming.** In BottomNav, tab #5 is called `Me` (as in the TopBar guest disabled-tabs list above and in the navigation map in [app-map.md](./pitchup-app-map.md)). The word "Profile" in the spec is used only for the content **inside** `/me` ("View public profile" row, "profile preview" in descriptions) and for the public page `/users/:id` — not for the tab itself.

### BottomNav (sticky)
**5 tabs, pill-style active:**

| # | Tab | URL | Label on pill | Who |
|---|---|---|---|---|
| 1 | My matches | `/my-matches` | "My matches" | auth-only (disabled for guest) |
| 2 | Games | `/games` | "Games" | guest + auth |
| 3 | Map | `/map` | "Map" | guest + auth |
| 4 | Chats | `/chats` | "Chats" | auth-only (disabled for guest) |
| 5 | Me | `/me` | "Me" | auth-only (disabled for guest) |

**Tab 5 — Me:** not just a profile but a combined screen: own profile preview (avatar, name) + settings block (Notifications, Sign out, Delete account). Effectively replaces a separate settings page — everything in one place.

**Pill style:** inactive tab — icon only in neutral color (no label). Active tab — dark capsule (pill) with white icon + text label inside. Capsule is wider than a regular icon; inactive tabs compress to fit everything. Intentional UI decision (reference taken from competitors with 5-tab nav) — saves vertical space, makes active tab clearly highlighted, label isn't duplicated in TopBar.

**Create new match:** regular `[+ New match]` button in the top bar on `/games` and `/map` (next to searchbar). **Floating FAB removed** — button in top bar is less prominent on small screens, but also doesn't cover content.

**Captain workspace:** accessible via `/my-matches → Section Captain` (shown only if there are organized matches). No separate tab for captain.

**Desktop:** BottomNav is anchored to the bottom of the central 480px container (see "Viewport" above), not to the bottom of the viewport.

### MatchCard (horizontal)

Minimalist text format — no cover image.

```
┌─────────────────────────────────────────┐
│  [role badge if present]                │
│  Venue name, District                   │
│  Tue 27 May · 19:00                     │
│                                         │
│  👤 7 a side by Mark H.      [9/14]     │
│                                         │
│                               Free      │
└─────────────────────────────────────────┘
```

**Card rows:**
- **Venue name + district** (bold heading)
- **Date + time** (`Tue 27 May · 19:00`)
- **Captain line:** avatar (24px) + `N a side by <captain short name>` on the left (e.g. "by Mark H." — first name + last name initial, to fit the row; no `@handle` — no username in the system, see "Unique login / username" above), slot counter `[X/Y]` on the right. Counter: green → almost full → red if full. **Stubs from `captain_crew` are included in "accepted" for the counter** — `9/10` where 9 = 1 captain + 8 stubs works naturally. **N a side:** `N = Math.floor(total_spots / 2)`, minimum 1. Example: total=14 → 7 a side, total=13 → 6 a side, total=9 → 4 a side.
- **Price / "Free"** — bottom right corner

**What's been removed from the card** (intentionally, documented):
- Cover venue — no (only on match page)
- Surface icon + studs badge — no (on match page in Tab Details)
- `✓ Booked` / `⚠ Gathering` — no (on match page)
- Tags — not in v1

**Optional role badge** (top row of card, only in contexts where status is needed):
- `Captain` — in `/my-matches → Section Past` and `/my-matches → Section Captain`, in `/chats`
- `You're in ✓` (green) — in `/my-matches → Section Upcoming` for accepted
- `Waiting…` (grey, 50% opacity) — in `/my-matches → Section Upcoming` for pending
- `👀 Watching` (micro) — in `/my-matches → Section Upcoming` for watching
- In `/games` and `/map` role badge is not shown (context there is search, not "mine")

**Mini avatar roster** (only in the "Your next match" featured card in `/my-matches`, see [personal.md](./pitchup-spec-personal.md)):
- Stack of 5 overlapping avatar circles from left to right.
- Order: captain → real accepted (by accept date) → stubs from `captain_crew` (by creation order).
- Stubs render as grey silhouette avatars (no name, name is only visible in Tab Lineup).
- If accepted+crew > 5 — last circle is replaced with `+N` badge.
- Below the stack — line: `"Mark H., Pavel, Tomas and 11 more are attending"` — real users by short name (first name + last name initial on collision within the match, otherwise just first name; no `@handle` — no username in the system), stubs — by first name from `captain_crew`. Same order. Truncated after 3 names.

Card states: Open / Almost full / Full / You're in / Cancelled

### PlayerChip
- 40px avatar + name
- Tap on chip → `/users/:id` (player profile). Guest can tap too — profiles are public
- Pending state: chip at 50% opacity. Accepted — full color.
- **Stub variant** (for stub players from `captain_crew`, see "Match type" → terminology): grey silhouette avatar + first name only, 50% opacity, **not tappable**. Long-press / hover → tooltip `"Not on app yet"`. Used only in Tab Lineup and mini-rosters in MatchCard.

### Loading state
- All screens with lists show **skeleton placeholders** during loading (match cards, player roster, admin tables)
- Skeleton mimics structure (avatar circle, text stripes), not a spinner

### Error / empty pages
- **Match not found** (404 on `/matches/:id` with unknown id) → "This match doesn't exist or was deleted. [Back to Games]"
- **Match cancelled** — no separate error page. Regular `/matches/:id` opens with banner "Match cancelled · [reason]". CTA bar fully disabled.
- **403 Forbidden** (attempt to open `/matches/:id/edit` by non-captain) → "Only the organizer can edit this match. [View match →]"
- **Network error** (any fetch failed) → toast "Couldn't load. [Retry]"

### Legal pages (`/legal/terms`, `/legal/privacy`)
- Static markdown, no interactivity. One screen — heading + content + footer. Accessible to everyone without login.
