# PITCHUP — Spec: personal screens & admin

> Part of the spec. File map — [INDEX](./pitchup-spec-INDEX.md).
> ⚠ **After editing this file** — run the audit checklist in the header of [pitchup-app-map.md](./pitchup-app-map.md) and update the map in sync if the checklist points are affected (stack, nav, TopBar, login, PWA, cron, lifecycle, entities).
> Covers: `/my-matches`, `/chats`, `/me`, `/users/:id`, `/admin/*` (users / matches / venues / reports), known gaps, out of scope for v1.

---

## `/my-matches` — Home (signed in)

Single summary page — "everything about my matches". One scroll, no sub-tabs, no chip filters. Sections separated by text dividers; empty sections are not rendered.

**Layout (top to bottom):**
1. **TopBar** (logo + 🔔). No "Hello, [Name]" greeting — the user's identity is clear from context.
2. **Section: Likes reminder** (if there is a recently ended match awaiting likes):
   - Banner card with pending likes. **Computed on-read** during SSR of `/my-matches`: SELECT matches where the user was `captain` or `accepted`, status Ended (`now() >= start_time + duration`), and the user has **not yet given any like** in that match (`NOT EXISTS (Like WHERE match_id=? AND giver_id=?)`). No poll entry — match status is on-read, there is no emitter for the Ended transition. If the user is already on an open `/my-matches` and their match transitions to Ended during the session — the card appears after reload / pull-to-refresh (known MVP simplification).
     - **1 match:** `"1 match awaits your likes · [Open]"` — tap navigates to that `/matches/:id`.
     - **2+ matches:** `"N matches await your likes · [Open]"` — tap scrolls to `/my-matches → Section Past`, where each such card gets its own mini-badge `Awaiting likes`. Likes are given per-match — no bulk flow.
     - On the match page the CTA `[Like teammates]` is visible at the bottom — the user taps it themselves. Auto-opening the likes modal via URL parameter — see "Known gaps" below.
3. **Section: Captain** (matches where the user is captain AND `match.status ∈ {Open, AlmostFull, Full, InProgress}`):
   - **Non-overlap rule with Section Past.** Ended and Cancelled captain matches appear **exclusively** in Section Past (with a `Captain` mini-badge), not in Section Captain. Each match shows up in exactly one section — never both.
   - `MatchCard` with a `Captain` badge + `N pending` badge (orange, if there are pending requests) + a `[Manage →]` button on the right side of the card → `/matches/:id?sheet=captain`. The URL parameter `?sheet=captain` signals the match page to auto-open the captain sheet on load. If pending = 0 — the button still navigates with the same parameter (the captain sheet opens, just with an empty pending list).
   - For **InProgress** matches the `[Manage →]` button is replaced with `[View →]` → `/matches/:id` (the captain sheet is unavailable after start; `[🎲 Shuffle teams]` remains available from Tab Lineup). The `N pending` badge is hidden (pending requests have already been auto-rejected).
   - Sorted by `start_time` ASC.
4. **Section: Upcoming** (accepted / pending / watching — mixed):
   - **First card** — enlarged MatchCard styled as "Your next match": venue name, date/time, **countdown if < 24h**, mini-roster of avatars, `[View match →]` button. This is the content migrated from the former `/home → Your next match`.
   - Remaining cards — standard `MatchCard` with state badges: `You're in ✓` (green, accepted), `Waiting…` (grey, 50% opacity, pending), `👀 Watching` (micro-badge, watching).
   - **InProgress matches:** the card stays in Section Upcoming (does not move to Past) — the accepted player is still "in the match". The timer/counter is replaced with a `🔴 In progress` indicator (same as on the match page). **Pending:** by the time a match goes InProgress, pending requests have already been auto-rejected by cron — they move to Section Past. **Watching:** a `👀 Watching` card **disappears** from Upcoming when the match transitions to InProgress (the Watch record remains in the DB, but Section Upcoming does not show watching cards for matches with InProgress status — the match has started, waiting for a slot is pointless).
   - Sorted by `start_time` ASC. Badges replace the old chip filters — no filter, everything in one feed.
5. **Section: Past** (history):
   - Shows **ALL** matches where the user had `JoinRequest.status ∈ {accepted, left, kicked, rejected (with auto_reason=match_started|match_cancelled), cancelled}` OR was captain, provided `match.status ∈ {Ended, Cancelled}`. Also watching cards (a Watch record exists at the time of Ended — the match ended at full capacity).
   - **Sub-label on the card** (depends on the user's historical role in the match):
     - `accepted` + Ended → "Played"
     - `accepted` + Cancelled → "Match was cancelled" (JoinRequest.status stays `accepted` on cancel — see "my_status mapping" in [global.md](./pitchup-spec-global.md))
     - `left` → "You left" (+ reason if saved)
     - `kicked` → "You were removed"
     - `rejected` (manual) → "Request declined"
     - `rejected` (auto_reason=`match_started`) → "Request expired"
     - `rejected` (auto_reason=`match_cancelled`) → "Match was cancelled"
     - `cancelled` (user cancelled own pending) → "You cancelled your request"
   - Sorted `start_time` DESC. Initial render limit — 20 cards; `[Show more]` loads the next page.
   - Cards where the user was captain — mini-badge `Captain`. Watching cards in Past have no role badge.
   - **Like reminder** appears only for `status=accepted` + match Ended (see Likes reminder section above).
6. **BottomNav** (sticky).

**Empty state** (everything empty — no captain, upcoming, past):
- Illustration + "No matches yet."
- Two CTAs stacked: `[Find a match →]` (primary, → /games) and `[+ New match]` (ghost, → /matches/new).

**Buttons:**
| Element | Action |
|---|---|
| TopBar 🔔 | Updates panel |
| MatchCard | → /matches/:id |
| `[Manage →]` in Captain card (Open/Full) | → `/matches/:id?sheet=captain` (captain sheet always opens; if pending=0 — sheet is empty) |
| `[View →]` in Captain card (InProgress) | → `/matches/:id` (no `?sheet=captain` — sheet unavailable) |
| Likes reminder `[Open]` | → /matches/:id (Tab Lineup) |
| `[Show more]` in Past | loads next 20 cards |
| `[Find a match →]` (empty) | → /games |
| `[+ New match]` (empty) | → /matches/new |

**States:**
- **Loading:** skeleton cards (3–4 per each visible section).
- **Empty state** — see above.
- **No matches in the system (0 matches total):** for a new user this is equivalent to the empty state — show the same two CTAs. No separate "Be the first →".

**Polling:** `GET /api/updates/state` every 15s (see "Polling sync" in [global.md](./pitchup-spec-global.md)). Triggers that re-render the page:
- `matches_changed` entry — recalculates sections (Captain / Upcoming / Past) and card order.

**Pending window ≤5 min:** a pending card for a match with `now() >= start_time` is shown with the `Waiting…` badge until auto-reject (window ≤5 min — cron interval). Accepted as a known edge case.

**Open→InProgress→Ended transitions:** computed on-read; no poll entry is emitted for status transitions (there is no cron for match status transitions — see app-map.md). Cards in Section Upcoming may show a stale status until reload — acceptable: the countdown ticks on the client independently, on the next SSR it recalculates.

**Likes reminder section** is not reactive — computed on-read at every SSR of `/my-matches`. See section description above.

**Guest:** `/my-matches` content is auth-only. The tab icon in BottomNav is disabled; tap → `/login?callbackUrl=/my-matches`. Direct URL access by a guest → `/login?callbackUrl=/my-matches`.

---

## `/chats` — Match chats

Tab aggregator for all match chats where the user is a participant (accepted) or captain. UX cousin of `/games`: a list of MatchCards, tap → `/matches/:id`. Direct messages (DM 1-1) are **not in v1** — only chats tied to matches.

**Layout (top to bottom):**
1. **TopBar:** standard (logo + 🔔). No `[Filters]`, no search bar — the list is limited to the user's own matches, not hundreds.
2. **List of MatchCards:**
   - Filter: matches where the user is `accepted` or `captain`. Watching and pending are **excluded** — they have no chat access.
   - **Past matches are included** — their chats are not locked after Ended (see chat rules in [match.md](./pitchup-spec-match.md)).
   - **Sorting:** by timestamp of the last message in the chat (DESC). Matches with no messages go to the bottom and are sorted by `start_time` ASC among themselves. Goal — surface active chats, even past ones. A fresh Open match with no messages still ranks below a past match with active chat — acceptable, since it appears in Section Upcoming on `/my-matches`.
   - **Card:** standard `MatchCard` + **unread dot** in the card corner (if there are unread messages in that chat for the user). No last-message preview in v1 (Telegram style can come in v1.1).
3. **BottomNav** (sticky).

**Buttons:**
| Element | Action |
|---|---|
| MatchCard | → `/matches/:id?tab=chat` — opens directly on Tab Chat (see "Deep-link `?tab=chat`" in [match.md](./pitchup-spec-match.md)). The user can switch to Lineup by tapping the Tab bar — the button is always there. |
| TopBar 🔔 | Updates panel |

**States:**
- **Loading:** 4–6 skeleton cards.
- **Empty state** (no matches with chat access): "No conversations yet. Join a match to start chatting." + `[Find a match →]` (→ /games).

**Live updates on `/chats`:** the global poll (`GET /api/updates/state` every 15s) triggers a list re-render when `matches_changed` contains a relevant `match_id` (e.g., user just approved → new match card appears; user kicked → card removed). **New chat messages do NOT produce a `matches_changed` entry** — card sort order (by latest message) and unread dots are computed on-read from `ChatRead`/`ChatMessage` on each page render or pull-to-refresh. Live per-message updates are only available on the `/matches/:id` page via per-match poll. This is an intentional MVP simplification (see "Polling sync" in [global.md](./pitchup-spec-global.md)).

**Unread chat dots — data model.** Source of truth — the `ChatRead(match_id, user_id, last_read_at)` table with composite PK (see ERD in [app-map.md](./pitchup-app-map.md)). One row per (user, match) pair; created lazily on first Tab Chat open.

- **Whether there are unread messages:** `EXISTS (ChatMessage WHERE match_id=? AND created_at > ChatRead.last_read_at AND deleted_at IS NULL AND author_id != ?)` for the given user. The user's own messages are not counted as unread. If there is no `ChatRead` row at all — unread = all messages in the chat (after the first Tab Chat open the row is created immediately).
- **Mark-as-read:** when the user opens Tab Chat on `/matches/:id` — the backend does `UPSERT ChatRead(match_id, user_id, last_read_at = now())`. This is the **only** mark-as-read trigger; scroll position and individual bubble visibility are not tracked (MVP simplification).
- **Multi-tab consistency:** after the UPSERT, all tabs of the user see the cleared unread dot on the match card in `/chats` on their next `GET /api/updates/state` poll (see "Polling sync" in [global.md](./pitchup-spec-global.md)).
- **Per-message delete by captain** (soft-delete via `deleted_at`) — the message disappears from the unread query automatically (filtered by `deleted_at IS NULL`). If the user had not read the chat, the captain deleted the last message, and nothing else arrived — the dot clears on the next render of `/chats`.

**Guest:** `/chats` content is auth-only. The tab icon in BottomNav is **disabled** (grey); tap → `/login?callbackUrl=/chats`. Direct URL access by a guest → `/login?callbackUrl=/chats`.

**Out of scope v1** (documented in "Known gaps" below):
- DM 1-1 between players — no; communication only in the context of a specific match.
- Chat search.
- Last-message preview on the card.
- Mention notifications (@username).
- Inbox folders / categories (Active / Archived) — one flat list.

---

## `/me` — Profile + settings (single page)

Combined page: the former `/me` (profile + tabs Upcoming/History) and `/me/settings` (toggles + legal + sign out + delete) now live at one URL. The Upcoming/History tabs have **moved** to the dedicated `/my-matches` tab. `/me` keeps only the profile and settings menu items.

**Layout (one scroll, top to bottom):**

1. **TopBar:** standard (logo + 🔔). **No gear icon** — it is no longer needed; settings are directly on this page.
2. **Header:**
   - Avatar (large circle).
   - Name.
3. **Section "ACCOUNT"** (small uppercase grey heading):
   - **Edit profile** — row with ✏️ icon on the left and `›` chevron on the right → bottom-sheet/modal (name, Contact info; avatar is from Google, not editable; `[Save]` / `[Cancel]`).
   - **View public profile** — row with 👤 icon → `/users/:user_id` (what others see).
4. **Section "NOTIFICATIONS"**:
   - **Email notifications** — row with ✉️ icon + caption "We'll email you when you get accepted, removed, or on match day." + **toggle on the right** (on/off, default **on**). Controls approve, kick, and morning reminder together. Detailed logic — in "Notifications" in [global.md](./pitchup-spec-global.md).
   - **Browser notifications** — row with 🔔 icon + caption "Get notified even when the tab is in the background." + toggle (default **off**). **Row is hidden on iOS** — UA contains `iPhone|iPad|iPod` (all iOS browsers — Safari/Chrome/Edge/Firefox — run on WKWebView; the Notification API without PWA does not work there). First tap on the toggle triggers the native browser permission request. Saved in localStorage (browser setting, not account setting). Details — in "Browser notifications" in [global.md](./pitchup-spec-global.md).
   - **In-app inbox** (🔔 in TopBar) — **not configurable, no separate toggle**, always on.
5. **Section "LEGAL"**:
   - **Terms of service** — row with 📄 icon → `/legal/terms`.
   - **Privacy policy** — row with 🔒 icon → `/legal/privacy`.
6. **Section "ACCOUNT ACTIONS"** (or simply visually separated):
   - **Sign out** — row with `[→` icon, standard (not destructive) → logout, redirect to `/`. **The only** sign-out entry point in the authenticated area of the app. (Exception — `/welcome`: while the user has not yet completed onboarding, the TopBar has a ghost link `Sign out` on the right — a separate exit for "signed in, changed my mind". See "/welcome — Onboarding" in [global.md](./pitchup-spec-global.md).)
   - **Delete account** — row with 🗑️ icon, **destructive style** (red text/icon) → confirm modal:
     - If the current user is the **only non-banned admin** (`is_admin=true` AND `count(is_admin=true, banned=false) === 1`) → blocking text: "You're the only admin. Promote another user to admin first, then you'll be able to delete this account." The `[Delete account]` button is **disabled**; only `[Cancel]` is available. This branch takes priority over all others — it blocks; the others inform. Server backstop: `DELETE /api/me` starts with the same predicate used in demote/ban (see "Admin role management & safety" — `target.is_admin === true && count(is_admin=true, banned=false) === 1`). If the predicate is true → `409 last_admin` with message "Cannot delete the only remaining admin. Promote someone else first." This is the source of truth; the UI block is its mirror.
     - If the user is **captain** of at least one upcoming match → "You're the organizer of **N upcoming match(es)**. They will be cancelled and players will be notified. This can't be undone." **N = matches where user=captain, match status ∈ {Open, AlmostFull, Full}, `start_time > now()`. InProgress matches are not included in N — they continue as a ghost match** (see "Ghost-match" in [global.md](./pitchup-spec-global.md)).
     - If the user is **only a participant** (accepted in others' matches but not captain) → "You're signed up for **N upcoming match(es)**. Your spots will be freed for others. This can't be undone."
     - If there is nothing → "Your profile and history will be permanently removed. This can't be undone."
     - Buttons: `[Delete account]` destructive / `[Cancel]`. No "type DELETE to confirm".
7. **BottomNav** (sticky).

**What is NOT on `/me`** (explicitly documented to avoid confusion):
- ~~Tabs Upcoming/History~~ — moved to `/my-matches`.
- ~~Chip-row You're in / Waiting / Captain~~ — moved to `/my-matches → Section Upcoming` (badges on cards).
- ~~Wallet/Payments~~ — feature not in v1.
- ~~Following & Followers~~ — feature not in scope.
- ~~Language toggle~~ — UI is EN-only in v1 (see "Known gaps" below).
- ~~Contact Us / Rate App / Code of Conduct~~ — not in v1.

**Buttons:**
| Element | Action |
|---|---|
| `Edit profile` | modal with fields: name, Contact info (textarea "How to reach me"). Avatar is from Google, not editable. `[Save]` / `[Cancel]` |
| `View public profile` | → /users/:user_id |
| Email notifications toggle | saves to DB; takes effect on the next notification |
| Browser notifications toggle | first tap — permission request; saved to localStorage |
| `Terms of service` / `Privacy policy` | → /legal/* |
| `Sign out` | logout → redirect to `/`. Auth.js deletes the session cookie on the current device — other devices/tabs of this user remain signed in (mass-revoke of all jti — "Sign out everywhere" — v1.1, not in MVP; see "Authentication" in [global.md](./pitchup-spec-global.md)). Guest sees the landing page. |
| `Delete account` | confirm modal → DELETE /api/me → redirect to `/`. Backend in the same transaction as DELETE — sets `users.deleted_at = now()`, which invalidates all sessions for the user (column-based invalidation; no separate `revoked_sessions` table). Frontend does sign-out, redirects to `/`. Guest sees the landing page. |

**Guest:** `/me` content is auth-only. The tab icon in BottomNav is disabled; tap → `/login?callbackUrl=/me`. Direct URL access by a guest → `/login?callbackUrl=/me`.

---

## `/users/:id` — Public player profile

Accessible to everyone (including guests). Minimal "person card".

**Blocks:**
1. TopBar (`← Back`)
2. Avatar (large) + name
3. Contact info (if filled in) — as text, links are automatically clickable. If empty — section is not shown
4. `[⋯]` button in the top right → dropdown: `Report player`.
   - **Signed in, someone else's profile** — tap → report submission modal (see "Submission modal" in `/admin/reports` below).
   - **Guest** — the `[⋯]` button is visible, `Report player` in the menu is visible; tap → Sign-in modal (`"Sign in to report this player"`). After sign-in, the user returns to the page and taps Report themselves.
   - **Own profile** — the `[⋯]` button is hidden entirely (the menu would be empty).

**States:**
- Opened own `/users/:id` → redirect to `/me`
- User not found → "This user is no longer on PITCHUP. [Back]" — `[Back]` = `router.back()`, fallback to `/games`.
- Banned or deleted user → "This user is no longer on PITCHUP." (unified text for privacy — the reason is not exposed).

**OG meta tags** (for sharing profiles in messengers):

| Tag | Value |
|---|---|
| `<title>` | `"{name} · PITCHUP"` |
| `<meta name="description">` | `"Check out {name}'s profile on PITCHUP."` |
| `<meta property="og:title">` | `"{name} · PITCHUP"` |
| `<meta property="og:description">` | `"Pickup football in Prague."` |
| `<meta property="og:url">` | `https://pitchup.online/users/{id}` |
| `<meta property="og:image">` | `/og/landing.png` (static default — we do not host Google avatars) |
| `<meta name="twitter:card">` | `"summary"` |

For banned and deleted accounts — default landing page tags.

---

## `/admin` — Admin panel (`is_admin=true`, `requireAdmin()`)

**Access:**
- `is_admin=true` → normal access. `/admin` without a suffix → redirect to `/admin/users`.
- `is_admin=false` (signed in but not admin) → silent redirect to `/my-matches`. No 403 page — we do not expose the existence of the admin panel to regular users.
- Guest (not signed in) → standard `/login?callbackUrl=/admin`. After OAuth — if the new account has `is_admin=false` → /my-matches; if admin (virtually impossible for a new OAuth user, but formally) → /admin/users.

**Layout:** bottom-tabs with four items: Users / Matches / Venues / Reports (same mobile pattern, see "Viewport" in [global.md](./pitchup-spec-global.md)). Active item is highlighted.

All tables in the admin panel: when there are 0 results, show the row "No records yet" (for venues — "[+ Add the first venue]"). Loading — skeleton rows. On narrow viewports (480px) tables scroll horizontally inside their container (`overflow-x: auto`).

### `/admin/users`
- Table: avatar / name / email / joined / admin / status
- Column **admin** — `✓` if `is_admin=true`, otherwise empty.
- Search by name/email
- Filters: admin (all / yes / no) / status (active/banned)
- Row actions:
  - `[Ban]` (for active) or `[Unban]` (for banned)
  - `[Promote to admin]` for `is_admin=false` **or** `[Demote to user]` for `is_admin=true` (toggle button pair — only one is visible at a time). Button labels stay in terms of "admin/user" — this is UI copy, not a field name.
  - Row click (outside buttons) → `/users/:id` in a new tab. No separate `[View]` — it would be redundant.
- **Ban** → modal: reason (textarea, required) → `[Confirm ban]`. Ban is permanent. Lifted only by an admin manually via `[Unban]`. Consequences — see "Ban / account deletion" in [global.md](./pitchup-spec-global.md).
- **Promote / Demote** → confirm modal with "Reason" textarea (required), button `[Confirm promote]` / `[Confirm demote]`. Symmetric to the Ban flow. Reason is written to the audit log (see below).

#### Admin role management & safety

**Last-admin guard:**
- Server-side check before demote or ban: if `target.is_admin === true` AND `count(is_admin=true, banned=false) === 1` → reject with error `"Cannot demote/ban the last remaining admin"`. This is the source of truth.
- UI mirror: on the sole admin row the `[Demote to user]` and `[Ban]` buttons are disabled with tooltip `"Last admin — cannot be demoted or banned"`. A UX improvement, not a substitute for the server-side check.
- **Self-delete is also covered** — `DELETE /api/me` uses the same last-admin predicate and returns `409 last_admin`. UI mirror — in Section ACCOUNT ACTIONS confirm modal.

**Self-modification guard:**
- On the user's own row (marked with `(you)` next to the name), only the buttons that would normally be shown are disabled: `[Ban]` and `[Demote to user]` (for the user's own row with `is_admin=true` — `[Promote to admin]` is not rendered at all, per the toggle button pair rule). Tooltip on disabled buttons: `"You cannot modify your own account"`.
- Server backstop: `if (target_id === current_admin_id) → reject "You cannot modify your own account"`. Guards against direct API calls that bypass the UI.
- To step down from admin — ask another admin (or manual SQL if there is only one; but in that case the system still prevents demoting the last admin — this is by design, see "First-admin bootstrap" in [global.md](./pitchup-spec-global.md)).

**Audit log:**
- Every `promote` / `demote` / `ban` / `unban` is written to the `admin_actions` table: `id, actor_admin_id, target_user_id, action, reason, created_at`.
- In v1 the log is not shown in the UI — it is for appeals and investigations, read directly from the DB. A dedicated `/admin/audit` screen is a v1.1 candidate.

### `/admin/matches`
- Table: name / captain / date / venue / status / participants
- Search, filter by status
- Actions: `[Edit]` `[Cancel]` `[Hide text ▾]` `[Delete]`. Row click (outside buttons) → `/matches/:id` in a new tab.
- **Edit** → opens `/matches/:id/edit` (same screen as for the captain). The admin can edit the same fields as the captain — details in [match.md](./pitchup-spec-match.md) (`/matches/:id/edit`). For In progress / Ended / Cancelled the `[Edit]` button is disabled (same restriction as for the captain).
- **Cancel** → same modal as for the captain (textarea "Reason"). **Available only before `start_time`** — for In progress / Ended / Cancelled the button is disabled (same restriction as for the captain; see "Reject / Kick / Leave flows" in [match.md](./pitchup-spec-match.md)). To remove an already running or past match — use `[Delete]` (hard delete) and only for illegitimate cases.
- **Hide text** — content moderation tool for offensive / illegitimate text **in any match status** (including In progress / Ended / Cancelled, where Edit/Cancel are already unavailable). This is **not editing** — the admin does not rewrite the captain's text but hides the original with a placeholder. Details — in "Hide text (content moderation)" below.
- **Delete** = hard delete. The match and all related data (join requests, chat, likes) are erased. No in-app inbox / email **notifications to participants** — this is a tool for illegitimate matches (spam, fake). Cancel is the standard path when a match simply will not happen. **Cross-ref:** on admin delete, `GET /api/matches/:id/state` returns `{ deleted: true }` on the next poll (see "Polling for match state" in [match.md](./pitchup-spec-match.md)). The frontend on an open `/matches/:id` redirects to `/games` with a toast.
  - **Poll update on Delete.** To all affected parties (former captain, accepted, pending, watching) the next `GET /api/updates/state` poll includes a `matches_changed` entry `{ match_id, my_status: 'none', action: 'admin_deleted' }`. `my_status` is `'none'` because the JoinRequest row is physically deleted along with the match — there is no state to derive; `action: 'admin_deleted'` carries all UI semantics. Goal — not to notify (that is inbox/toast) but to trigger removal of the card from open tabs: `/my-matches → Section Upcoming/Captain` and `/chats` update within ≤15s. The entry does NOT create a notification row in the inbox, does not push a toast — it only triggers a re-render of the lists. **Frontend rule on `action: 'admin_deleted'`:** remove the match card from all lists (`/my-matches` sections Captain / Upcoming including `👀 Watching` cards, `/chats`) **without adding it to Section Past**. A deleted match does not appear in history — it is physically removed from the DB; `/matches/:id` → 404. This differs from `action: 'match_cancelled'`, where the card moves to Section Past. The match page on an open `/matches/:id` shows the standard 404 screen "This match doesn't exist or was deleted." (see "Error / empty pages" in [global.md](./pitchup-spec-global.md)).

#### Hide text (content moderation)

**Problem:** Edit is blocked after start (see `/matches/:id/edit` in [match.md](./pitchup-spec-match.md)), but an offensive description or cancel reason can remain in a past match — spam, slurs, threats. `[Delete]` wipes everything (chat, likes, history) for a single word — too blunt.

**Solution — hide flag.** The admin does not edit someone else's content; they hide it with a marker. The text remains in the DB (for appeals / audit); a placeholder is shown in the UI. Reversible.

**Fields under moderation:**
| Field | Where visible when not hidden | What is shown when hidden |
|---|---|---|
| `description` | Tab Details on `/matches/:id` | "[Description removed by moderator]" (neutral grey text) |
| `cancel_reason` | Cancelled banner on `/matches/:id`, MatchCard in /me History | "Match cancelled · [reason removed by moderator]" |

**Data model:** two boolean flags on the match — `description_hidden` (default false), `cancel_reason_hidden` (default false). The original text is untouched.

**UI in the admin panel:** dropdown `[Hide text ▾]` on the match row opens a check-menu:
- ☐ Hide description — if the match has a non-empty description
- ☐ Hide cancel reason — only for cancelled matches

Tapping a checkbox is an instant toggle — no "Save" button. Current state indicator: if at least one flag is on — the button in the row is highlighted `[Hide text ⚑]`.

**Availability:** in all statuses (Open / Almost full / Full / In progress / Ended / Cancelled). This is an intentional exception to the "no changes after start" rule — content moderation and content editing are different things.

**Notifications:** none — this is an admin action; no one is notified (the user will see it upon visiting the match). An audit log of hide operations is not built in v1; if needed we will add it as a separate entry in the `admin_actions` table later.

### `/admin/venues` — Venue directory
- Table: name / address / surface(s) / status (active/inactive) / Google Maps link
- Filter: status — all / active / inactive
- `[+ Add venue]` → form:
  - Name
  - Address (text)
  - Lat / Lng (numbers — copy from Google Maps URL)
  - **Surface(s)** — multi-select from two options: `Grass` / `Hard surface`. For exotic surfaces (sand, rooftop) pick the closest type. More detail — "Field surface" in [global.md](./pitchup-spec-global.md).
  - **Cover** — single-select from a palette of pre-made illustrations (see "Cover venue" in [global.md](./pitchup-spec-global.md)). Default — deterministically chosen by `venue.id` (formula there, not true random).
  - Google Maps URL (link, pasted manually)
  - Active: toggle
- Editing — same modal as `[+ Add venue]`, opens with pre-filled fields (`[Edit]` click on the row). Venue deactivation — "Active" toggle inside the same modal. No inline cell editing in the table.
- **Guard against deactivation with upcoming matches:** if the venue has at least one match with `start_time > now()` and a status other than Cancelled — the "Active" toggle is blocked (disabled) with hint "Can't deactivate — N upcoming match(es) on this venue. Cancel them first or wait until they end." `[Save]` is also blocked if the user tried to flip the toggle. This prevents accidental mistakes: otherwise players would see a live match at a venue that no longer exists in the directory, and the captain would not be able to edit it.
- **Deactivated venue:**
  - Does not appear in search on `/matches/new` (cannot create a new match there)
  - Past matches on it continue to display normally (history is unaffected)
  - Always visible in the admin table (status filter)

### `/admin/reports`

**Where reports come from:**
- **Report match** — `[⋯] → Report match` on `/matches/:id`. Signed-in users only (guests do not see the item).
- **Report player** — `[⋯] → Report player` on `/users/:id`. **Guest** sees the button; tap → Sign-in modal (see "Visual differences for guests" in [global.md](./pitchup-spec-global.md)). Hidden for the user's own profile (`[⋯]` hidden entirely) and for banned accounts.

**Submission modal (user-facing, identical for both types):**
- Title: "Report this match" / "Report this player"
- Caption: "We review all reports within 24 hours."
- Textarea "What's the issue?" — required, max 500 chars, placeholder "Describe the problem..."
- `[Submit report]` primary / `[Cancel]` ghost
- After submission: toast "Report submitted. Thank you." Modal closes. No confirmation screen.
- Backend: `POST /api/reports` with `{ type: 'match'|'player', target_id, comment }`. Duplicate report from the same user on the same target — backend returns 200 with no error (silently deduplicated, no toast spam).

**List in `/admin/reports`:**
- **Grouped by target.** Reports are aggregated by `(type, target_id)` — one row per target, even if N reports were submitted by different users on the same match/player. Row contains: type (Match / Player) · target (match name or player name — clickable, opens `/matches/:id` or `/users/:id` in a new tab) · **`{N} reports` counter** (badge if N > 1) · last reporter + date of last report · aggregated status (see below) · `[Review]` button. Without aggregation an admin would get 100 identical rows for a popular offender.
- **Aggregated status (status ladder):**
  - If there is ≥1 report with `status='New'` → group `New`.
  - Otherwise if there is ≥1 `Reviewed` → group `Reviewed`.
  - Otherwise → group `Dismissed`.
- The `[Review]` action picks the most recent `New` report (or the most recent overall if all have been handled) — its comment + author are shown in a modal, plus a "View all N reports" link that expands the full list of reports for that target inside the modal (comments + who + when + per-row status).
- **Report statuses** (per row, not aggregated): **New** / **Reviewed** / **Dismissed**. When a `[Review]` action (Ban / Cancel match / Hide text / Delete) is taken — **all** `New` reports on that target automatically transition to `Reviewed`. On `[Dismiss]` — only the currently open report → `Dismissed`; others on the same target stay as is (the admin can work through each one individually).
- Filter: type (All / Match / Player), aggregated status (All / New / Reviewed / Dismissed)
- **Sorting:** group `New` always on top, then `Reviewed`, then `Dismissed`. Within each group — by `latest_report_at DESC`.

**`[Review]` modal — report on a player (type: player):**
- Title: "Report on player"
- Block: avatar + name + `[View profile ↗]` link
- Full comment text
- From whom + date
- Buttons:
  - `[Ban player]` destructive → closes this modal, opens the **standard Ban modal** (textarea "Reason for ban" + `[Confirm ban]`) — same as in `/admin/users`. After ban → report status Reviewed.
  - `[Dismiss]` ghost → status Dismissed. Toast "Report dismissed."

**`[Review]` modal — report on a match (type: match):**
- Title: "Report on match"
- Block: venue name + date + match status + `[View match ↗]` link
- Full comment text
- From whom + date
- Buttons (not mutually exclusive — can hide text and dismiss the report):
  - `[Cancel match]` — visible only if the match is Open / Almost full / Full (before start). → opens the **standard Cancel modal** (textarea "Reason for cancellation") — same as for the captain. After cancellation → report status Reviewed.
  - `[Hide description]` toggle — hide/show description. Works in any status. Disabled if the match has an empty description. Same `description_hidden` mechanism as in `[Hide text ▾]` in `/admin/matches`. **Toggling hide/unhide does NOT change the report status** — to move to Reviewed/Dismissed an explicit `[Dismiss]` or a destructive action (Cancel/Delete match, Ban user) is required.
  - `[Hide cancel reason]` toggle — hide/show cancel_reason. Visible only for cancelled matches (hidden if the match is not cancelled). Same `cancel_reason_hidden` mechanism as in `[Hide text ▾]` in `/admin/matches`. Same rule: toggle does not change report status.
  - `[Delete match]` destructive — hard delete, any status. Same as `[Delete]` in `/admin/matches`.
  - `[Dismiss]` ghost → status Dismissed. Toast "Report dismissed."
- `[Cancel match]` and `[Delete match]` automatically move the report to Reviewed. `[Dismiss]` without other actions = "reviewed, found no violation".

**Connection to the rest of the admin panel:** all action modals in `[Review]` are the same as in `/admin/users` and `/admin/matches`. No duplicated logic — `[Review]` simply opens the appropriate modal with the appropriate `target_id`.

---

## Known gaps (intentionally left open in v1)

Questions that surfaced during the spec review and deferred — these are not bugs but conscious decisions of "not needed yet".

- **Venue deactivation — what happens to upcoming matches at that venue.** Resolved: the "Active" toggle is disabled while there is at least one non-cancelled match with `start_time > now()` at that venue. Details — in `/admin/venues` above.
- **`/admin/users` has no `[Delete user]` action.** Intentional — account deletion is only available to the user themselves from `/me` (Section ACCOUNT ACTIONS). The admin works via `[Ban]` (permanent; consequences described in "Ban / account deletion" in [global.md](./pitchup-spec-global.md)). Self-delete for an admin is guarded by the last-admin guard (see Section ACCOUNT ACTIONS in `/me` above) — the last admin cannot be deleted; another user must be promoted first.
- **`/matches/new` edge: total=8, crew=7.** The match is published immediately as full (1 captain + 7 stub players from `captain_crew`); only the `[Notify me]` button is available. Not blocked — let it be; the user will figure it out. (Earlier the edge was at `total=2`; after the `total_spots ≥ 8` constraint in `/matches/new` the minimum full-from-publish shifted accordingly.)
- **Pending request message is visible only in the captain sheet, not in inline Lineup buttons.** Intentional: inline = quick approve without reading; sheet = full review with the message.
- **Per-message chat moderation in a ghost match with a banned captain.** If the captain was banned while their match is running (InProgress without an active captain — see "Ghost-match" in [global.md](./pitchup-spec-global.md)), per-message `[Delete]` in Tab Chat is unavailable to anyone: the captain is banned (backend rejects), accepted players do not have that right, and in v1 the admin has no per-message delete in chat (only `[Hide text ▾]` for description/cancel_reason and `[Delete]` for the entire match in `/admin/matches`). An offensive message in a ghost match chat can only be removed by hard-deleting the entire match. Accepted as acceptable in v1 — the case is extremely rare (the captain must be banned between `start_time` and `start_time + duration` of their own match). If feedback shows it is needed — we will add admin-level per-message delete as a separate feature.
- **Visual "Gathering players" indicator on map pins is not built.** Status is visible in the bottom-sheet preview when tapping a pin. The pins themselves show only the free-slot count and red=full.
- **Likes reminder → auto-opening the likes modal is not implemented in v1.** The "N match awaits your likes" card on `/my-matches` navigates to a plain `/matches/:id`; the user sees the `[Like teammates]` CTA and taps it themselves. Auto-open via `?action=likes` — a UX improvement to add if feedback shows users are not finding the button.
- **Captaincy transfer.** Not in v1 — if the captain wants to leave, they cancel the match. The group reorganises via chat.
- **Match cancellation after `start_time`** (rain after kickoff, mass injury, force majeure) — not supported in v1. After start the match is considered to have taken place; such cases are handled outside the app (chat, direct message). Otherwise we would need to define semantics for an already-sent morning reminder, for likes, for History status. If feedback shows this is needed — we will introduce "post-start cancellation" as a separate flow.
- **Morning-of-match reminder — two-cron logic.** 10:00 for matches with `start_time >= 10:00` today (all remaining matches of the day, including 10:30, 11:00, etc.); 20:00 for matches with `start_time` tomorrow 00:00–11:59. Email to accepted players + the match captain. Details — in "Cron jobs" in [match.md](./pitchup-spec-match.md). DST semantics and idempotency via `reminder_sent` — in "Cron jobs" in [match.md](./pitchup-spec-match.md).
- **"Match details updated" notification.** Sent to accepted players only. Pending and watching players are not notified.
- **`/my-matches`: where cancelled matches land.** Resolved: cancelled matches immediately drop to Section Past after cancellation. Details — in "Match states → Cancelled" in [match.md](./pitchup-spec-match.md). Decision made because Section Upcoming should show only live matches (otherwise the "Your next match" featured card at the top could be a cancelled banner).
- **Language toggle in `/me` — not in v1.** UI is EN-only; showing a toggle with one option is pointless. Will appear much later together with a CS translation (next-intl is already in the codebase). When added — a `Language: EN / CS` item as a separate section in `/me`, default EN, choice saved to profile.
- **Dynamic OG image per match.** In v1 — one static image for all matches (`/og/match-default.png`). When added — `@vercel/og` runtime generator: cover-gradient venue + venue name + date/time + "N/M players" + small logo. This will give ~5× CTR in chats (rich preview with real match data vs. the same image every time). Implementation in Next.js 15: `app/matches/[id]/opengraph-image.tsx`.
- **Post-publish "Share with your crew" modal** on step 3 of `/matches/new`. Currently just a toast + redirect. The captain's peak motivation moment for sharing the link is missed — intentionally not built in v1 for minimal scope. The captain shares via `[⋯] → Share` like everyone else.
- **Share button in the captain sheet** — no separate prominent button; sharing is via the general `[⋯] → Share`. If feedback shows captains are not finding it — we will surface it.
- **Share analytics** (share counter per match, source tracking with utm parameters) — not in v1. The share → join correlation can be estimated from organic data.
- **`/games` and `/map` chips-only filters — dropped options.** Intentionally removed in v1 for simplicity: custom date range (Period — only Tonight/Weekend; other days reachable by scrolling the list), Price=Paid (nobody filters "paid only"), Spots left = 2–3 (only `⚡ 1 spot left` chip exists), Near me with distance options 3/10 km (fixed at 5 km), `👤 My matches` chip (replaced by the dedicated `/my-matches` tab). If feedback shows demand — add them back as chips or restore a `[Filters ▾]` button for advanced filtering.
- **Time display boundary at exactly 24h.** At the transition from countdown ("Starts in 23h 59min") to absolute date ("Tue 20 May, 19:00") at the 24h mark there will be a sudden format jump. Polling every 10 s — it can be noticed. Not fixed: the frontend reads the same `start_time`, the formula `delta < 24h ? countdown : abs` is 1 line of code, and the jump happens once per match lifetime. Boundary: `delta < 24h` → countdown, otherwise absolute date (i.e. exactly 24:00:00 = absolute date).
- **`/chats` — v1.1+ extensions.** Intentionally scoped to minimum in v1:
  - **DM 1-1** between players — no. Communication only in the context of a specific match. If players want to connect "outside" — each profile has Contact info (Telegram/WhatsApp/email).
  - **Last-message preview** on the card in `/chats` — no. Only unread dot + match info. Telegram style ("last message: 'who's bringing the balls?'") in v1.1.
  - **Mention notifications** (@username mention in chat) — not in v1. We have no usernames, and chat volume is low for now.
  - **Inbox folders / categories** (Active / Archived / Unread) — no. One flat list sorted by last activity.
  - **Chat search** — no. The list is limited to the user's own matches; scrolling will find the right one.
- **Admin role bootstrap edge case.** If all admins are banned (data corruption, manual mass-ban via SQL, etc.) — the system cannot recover through the UI (requires a signed-in admin). Recovery — manual SQL: `UPDATE users SET banned = false WHERE id = ...`. Session invalidation is column-based (no `revoked_sessions` table) — unbanning automatically restores access on the next API call. See also "First-admin bootstrap" and "Session invalidation" in [global.md](./pitchup-spec-global.md).
- **Email address change — no UI to edit.** Name, avatar, and email are snapshotted from Google at onboarding and never re-synced (see "Google profile — snapshot, not sync" in [global.md](./pitchup-spec-global.md)). If a user changes their Google email afterwards, in-app notifications (email channel) keep going to the snapshotted address. There is no `/me → Edit profile` field for email in v1. Adding it is a v1.1 candidate if feedback shows the gap matters.
- **Responsive / desktop breakpoints — not in v1.** All layouts are designed for mobile (max-width 375px central container — see `mockups/`). Desktop and tablet renders fall back to the same narrow column — readable but not optimised. Adding breakpoints is deferred until usage data shows desktop demand.
- **Dark theme — not in v1 launch.** v1 ships **light only**: cream surfaces + dark green + lime accent, canonical tokens in `mockups/match.html`. `next-themes` is wired in but pinned via `forcedTheme="light"`; the v1.1 switch to add dark mode is a single-line change once dark-palette tokens are designed. Rationale: design effort focused on getting one palette right rather than maintaining two; previous dark-only zinc-palette mockups are retired. Revisit when a user requests dark mode or when usage patterns show evening sessions dominate.
- **Username / handle — not in v1.** User identification in the UI = name + avatar. The `handle` field does not exist in the DB. Consider in v1.1 if deep-links to profiles / unique share URLs are needed (`/u/markh` instead of `/users/:uuid`).
- **Appeals** (appeal against a ban) — handled manually via Google Workspace alias `appeals@pitchup.online`. An admin panel for appeals (a `/admin/appeals` page with a queue) — not in v1.
- **`[Show older]` pagination in the Updates bottom-sheet** — not in v1. Limit of 20 records; mark-as-read applies to all unread items (including those beyond the 20th if they exist — an extremely rare edge case; TTL 30 days).
- **Captaincy transfer** (transfer captaincy to another accepted player) — not in v1. Duplicated in "Out of scope for v1" below.
- **Recurring matches** (repeating weekly slots) — not in v1.

---

## Out of scope for v1

- Payments in the app
- User photo upload (avatar — from Google only; no file storage)
- **Additional OAuth providers.** Only Google in v1. Apple/Facebook/email-password — later, when there is a real demand signal (users from countries where a Google account is not the default, corporate emails without Google). JWT and middleware are already structured to extend to a `(provider, providerId)` composite key — see "What's in the JWT" in [global.md](./pitchup-spec-global.md).
- Native apps (PWA)
- Real-time updates via SSE / WebSocket — polling (15s interval) is sufficient in v1; SSE deferred to v1.1 pending real usage data
- Video, AI highlights
- Tournaments / leagues
- Field booking
- Social network features (followers, feed)
- SMS notifications
- **Team shuffle: persistence and features.** The `[Shuffle teams]` feature itself is in v1 (see "Shuffle teams" in [match.md](./pitchup-spec-match.md)), but in the simplest possible form:
  - Result is stored only in the captain's **localStorage** — different device / incognito / cache clear = shuffle again.
  - Players **do not see** the result in the app (no push, no block in Tab Lineup, no system message in chat — captain copies and shares manually). The captain copies via `[Copy as text]` and sends it wherever needed.
  - No balancing — pure random, no skill / weight / win rate.
  - No manual editing after shuffle (only `[Shuffle again]`).
  - Guests (`+N`) go into the shuffle as anonymous `Guest 1, Guest 2, ...` — an intentional nudge to register. See "Shuffle teams" in [match.md](./pitchup-spec-match.md).
