# PITCHUP — Spec: match discovery

> Part of the spec. Full file map — [INDEX](./pitchup-spec-INDEX.md).
> ⚠ **After editing this file** — run the audit checklist in the header of [pitchup-app-map.md](./pitchup-app-map.md) and update the map in sync if the checklist points are affected (stack, nav, TopBar, login, PWA, cron, lifecycle, entities).
> Covers: `/games` (list) and `/map` (map view). Both are guest-readable; they share filters via URL.

---

## `/games` — Match list

Previously `/discover` in list mode. The main public pool, accessible to guests.

**Layout (top to bottom):**
1. TopBar (logo + 🔔; for guest — logo + `[Sign in]`). See components in [global.md](./pitchup-spec-global.md).
2. **Sticky filter bar** (h≈56px):
   - Search field `[🔍 Search venue...]` — live-filter by venue name.
   - **`[⚙]` icon-button** to the right of the searchbar — opens the "More filters" bottom-sheet (see dedicated section below). When ≥1 sheet filter is active — a small accent dot (badge) appears in the top-right corner of the icon. Available to guests too (filters are public, not auth-gated).
   - To the right of `[⚙]` — **`[+ New match]`** button (regular button, not FAB). For guest — tap → `/login?callbackUrl=/matches/new`.
3. **Sticky day picker** (h≈64px, sticky together with the filter bar — this is the primary filter and must always be visible). Horizontal strip of days:
   - Each cell is 2 lines: day name on top (`Tue`, `Wed`, ...), number below (`19`, `20`, ...). Day localization — English in v1 (UI is EN only).
   - **Active day** — outlined with a thin border (rounded box), as in the reference. Inactive — no outline, text only.
   - **Single-select.** One day is always selected — no "all" / "any" mode. Tapping the already-active day does nothing (cannot deselect).
   - The strip covers **21 days starting from today** (typical pickup-football horizon; matches beyond 3 weeks are rare — see "Known gaps" in [personal.md](./pitchup-spec-personal.md)). ~7 days are visible at once; the rest are accessible by horizontal scroll.
   - **Default:** today. If a day other than today is selected — a small ghost button `[← Today]` appears below the strip (left-aligned, not inside the strip itself); tap returns to today.
   - **Label below the strip** — small grey text: `Today` / `Tomorrow` / full day name + number (`Thursday 21`) / `DD MMM` for dates more than a week out. Duplicates the selection for readability.
   - **Past dates are not shown in the day picker** — the strip starts from today. Ended matches live in `/my-matches → Section Past`, not in the public search. Same principle applies to Cancelled and InProgress matches (see "Match states" in [match.md](./pitchup-spec-match.md) — Cancelled and InProgress are removed from public discovery; only accessible via direct link / `/my-matches`).
4. **List of MatchCards** for the selected day, sorted by `start_time` ASC. **No date grouping** — all cards are for a single day, no section header needed. A small label above the list shows `{N} matches` (`12 matches today`).
5. **BottomNav.**

### "More filters" bottom-sheet

Opens by tapping `[⚙]` in the filter bar (layout item 2). Header "Game filters", close button `[✕]` on the left. Content — sections with subheadings. Footer (sticky inside the sheet): `[Apply filters]` primary + `[Reset]` ghost (centered).

**Apply / Reset behavior:**
- **No live filtering inside the sheet** — changes accumulate locally (draft state) and are applied only on `[Apply filters]`. This is intentional: radio + multi-chip combinations would otherwise spam the backend on every tap.
- `[Apply filters]` — closes the sheet, rewrites URL params (`?distance=`, `?time=`, `?size=`, `?spots=`), list recalculates. If no sheet filter has changed relative to the currently applied state — the button is disabled, tooltip `"Nothing to apply"`.
- `[Reset]` (inside the sheet) — resets all sheet filters in draft state to default (Any / empty), but does not close the sheet or apply automatically. To commit the reset — tap `[Apply filters]`.
- **Closing the sheet without Apply** (tap outside, swipe down, `[✕]`) — draft is discarded, applied filters remain as-is.
- **On re-opening** the sheet — fields show the currently applied state (not the last draft).

**Sheet sections** (top to bottom):

**📍 Distance** (radio). Always shown (regardless of geolocation permission state).
- **Location is set** (GPS or manual pin in localStorage) → radio buttons: `Any` (default) / `1 km` / `3 km` / `5 km` / `10 km`
- **Location is not set** (any permission state) → instead of radio buttons, a single `[Set location]` button. Tap → navigate to `/map?pickLocation=true` (the map opens the Location modal automatically). **No auto-return** — the user navigates back to `/games` via BottomNav when the location is set (the sheet re-opens with applied filters; draft is lost per the general rule — see "Apply / Reset behavior" above). This is an intentional simplification: one screen = one task, no hidden state-passing.
- URL: `?distance=1|3|5|10` (absent = Any). If location is not set in localStorage — the param is ignored (filter not applied).

**🕐 Time of day** (multi-select chips). Filter **on top of** the selected day (AND logic).
- `Morning` (06:00–11:59) / `Afternoon` (12:00–17:59) / `Evening` (18:00–22:59)
- Multi-select: none active = any time; multiple active = OR between them (e.g. `Morning` + `Evening` = matches 06:00–11:59 OR 18:00–22:59 on the selected day).
- Match time of day is determined by `match.start_time` converted to Europe/Prague (duration is not considered). A match at 17:55 Prague time with 90-min duration = `Afternoon` (not `Evening`). The conversion follows the canonical TZ rule — see "Timezones & date ranges" in [global.md](./pitchup-spec-global.md). Day selection (`?date=YYYY-MM-DD`) is also a Prague day, not a UTC day (see `?date=` below).
- URL: `?time=morning,afternoon,evening` (any subset, comma-separated)

**⚽ Game size** (multi-select chips). Filter by match format.
- Chips: `4 a side` / `5 a side` / `6 a side` / `7 a side` / `8 a side` / `9 a side` / `10 a side` / `11 a side`
- **Mapping is exact:** chip `N a side` matches matches where `Math.floor(total_spots / 2) === N`. No tolerance.
  - `4 a side` = total_spots ∈ {8, 9}
  - `5 a side` = total_spots ∈ {10, 11}
  - `6 a side` = total_spots ∈ {12, 13}
  - `7 a side` = total_spots ∈ {14, 15}
  - `8 a side` = total_spots ∈ {16, 17}
  - `9 a side` = total_spots ∈ {18, 19}
  - `10 a side` = total_spots ∈ {20, 21}
  - `11 a side` = total_spots ∈ {22, 23}
- Matches with `total_spots < 8` **do not exist** in the system — `/matches/new` and PATCH `/matches/:id` reject `total_spots < 8` with `400 invalid_total_spots` (see "Step 2" in [match.md](./pitchup-spec-match.md) — stepper minimum = 8, so no match falls outside the Game size chips). Chips 4..11 a side cover the full valid range.
- Multi-select: none active = any size; multiple active = OR.
- URL: `?size=4,5,6,7,8,9,10,11` (comma-separated N from 4 to 11)

**⚡ Spots left** (radio). Filter by number of free slots = `computeSlots(match).free` (see "Slot math" in [global.md](./pitchup-spec-global.md)).
- `Any` (default — includes full) / `1 spot` / `2–3 spots` / `4+ spots`
- Any non-`Any` value = match with `free > 0` (any non-`Any` implicitly hides full matches). "Full matches only" is not a v1 feature.
- URL: `?spots=1|2-3|4+` (absent = Any)

**🆓 Price** (toggle checkbox). `Free only` — price = 0.
- URL: `?free=1` (absent = show all)

**✓ Field status** (toggle checkbox). `Booked only` — field_booked = true.
- URL: `?booked=1` (absent = show all)

**What is NOT in the sheet** (intentionally):
- Hide full as a separate option — expressed via `Spots left ≠ Any`.
- Surface filter — removed in v1 (too few matches for meaningful surface-based filtering).
- Women-only, Online payment, Favourite venues — these entities do not exist in v1.

**Total sticky chrome:** TopBar (56) + filter bar (56) + day picker (64) + BottomNav (56) = 232px.

**Controls:**
| Element | Action |
|---|---|
| Search | live-filter by venue |
| `[⚙]` (filter bar) | open "More filters" bottom-sheet |
| `[+ New match]` (filter bar) | → /matches/new (guest → /login?callbackUrl=/matches/new) |
| Day picker cell | single-select — changes the selected day, list recalculates immediately |
| `[← Today]` (below picker) | return to today; visible only when a day other than today is selected |
| `[Set location]` (Distance section in sheet) | → /map?pickLocation=true (only if location is not set) |
| `[Apply filters]` (sheet) | apply sheet filters and close sheet |
| `[Reset]` (sheet) | reset all sheet filters to default in draft state (not applied automatically) |
| MatchCard | → /matches/:id |
| BottomNav: Map | → /map (sheet filters carried over via URL — `?distance`, `?time`, `?size`, `?spots`, `?free`, `?booked`. **`?date=` is dropped** — the map shows all upcoming matches across the 21-day horizon, not a single day; see "Filter sync with `/games`" in the `/map` section below) |

**URL params** (for shareable filter state and sync between `/games` ↔ `/map`):
- `?date=YYYY-MM-DD` — selected day. Backend filters matches by `start_time ∈ prague_day(date)` (the canonical Prague-day → UTC interval — see "Timezones & date ranges" in [global.md](./pitchup-spec-global.md); length 23/24/25h at DST boundaries). Valid range: `today_prague() .. today_prague() + 20` inclusive (the 21-day horizon). If the param is invalid / in the past per Prague time / beyond +20 days — fallback to today (no error state). Symmetric with the day picker.
- `?distance=1|3|5|10` — radio from the sheet. Absent = Any. If location is not set in localStorage — param is ignored (filter not applied).
- `?time=morning,afternoon,evening` — multi-select from the sheet. Any subset, comma-separated. Absent = any time.
- `?size=4,5,6,7,8,9,10,11` — multi-select game size from the sheet. Any subset, N from 4 to 11. Absent = any size.
- `?spots=1|2-3|4+` — radio from the sheet. Absent = Any (including full).
- `?free=1` — toggle from the sheet. Absent = show all.
- `?booked=1` — toggle from the sheet. Absent = show all.
- All params absent = default (today, no filters).

**States:**
- **Loading:** 6 skeleton cards
- **Empty for selected day:** "No matches on {Today / Tomorrow / Thursday 21}." + hint `Try another day →` (with a small arrow pointing to the picker) + `[+ New match]`. If sheet filters are active — additionally `[Clear all filters]` (one button; removes sheet params from URL — same as applying an empty draft; does not affect day or search).
- **`?distance=` in URL, location not set:** thin info banner above the list (below the day picker, **not sticky — hides on scroll**): `"Distance filter ignored — set your location to enable it"` + ghost button `[Set location]` on the right. Tap leads to `/map?pickLocation=true` (same path as from the Distance section in the sheet). The banner can be dismissed with `×` (to the right of the button) — does not reappear for this session (state in memory, not localStorage); reappears on the next visit if the param is still in the URL and location is still unset. The list renders as if the param is absent (filter is silently ignored — API behavior unchanged, only the UI adds visibility).

**Pagination:** limit 50 matches per request (for the selected day). If there are more — `[Show more]` button at the bottom of the list, loads the next 50. Cursor-based pagination by `(start_time ASC, id ASC)`.

**Real-time:** `/games` and `/map` lists **are NOT subscribed to push updates**. Creates / cancels / edits are visible only on the next visit or pull-to-refresh. Slot counters on MatchCards update on read (fresh data on each visit). This is an accepted trade-off for MVP.

**Invalid query params fallback:** invalid query values (whitelist) for `?distance`, `?time`, `?size`, `?spots`, `?free`, `?booked` — param is ignored, no crash (behavior is symmetric with the `?date=` fallback).

> **What was dropped from filters after the redesign (sheet + day picker):** custom date range (Period — one day at a time only), `🔥 Tonight` (≈ Today + sheet's Time of day = Evening, two taps instead of one), `📅 Weekend` (Sat/Sun separately), Price=Paid (Free toggle only), "full matches only" filter (Spots left gives `Any` = including full, or non-`Any` = only with free slots; "full only" is not implemented). This is an **intentional simplification** for v1.

**Cancelled and In progress matches** are not shown on `/games` — the public list contains only matches with status Open / Almost full / Full. In progress matches are visible in `/my-matches` for their participants and via the direct link `/matches/:id`. See "Match states" in [match.md](./pitchup-spec-match.md).

---

## `/map` — Match map

A separate tab (previously the `?view=map` mode inside `/discover`). Full-screen map with pins per venue.

**Layout:**
1. TopBar (logo + 🔔; for guest — logo + `[Sign in]`).
2. **Sticky filter bar** (overlaid on the map, at the top): same as on `/games` — searchbar + `[⚙]` icon-button + `[+ New match]` on the right. `[⚙]` opens the "More filters" bottom-sheet (same as on `/games`, **without the date filter** — the map does not filter by day). All other filters (Distance, Time of day, Game size, Spots left, Price, Field status) work on the map too.
3. **Sticky info chip strip** (h≈40px, below the filter bar, sticky over the map). Horizontal strip of smart info chips. If no chip is visible — the strip collapses entirely (h=0).
4. **Map** full-screen (MapLibre + OSM). BottomNav remains sticky over the map — the user is not trapped.

**Info chips (v1 — one chip):**

| Chip | Text | Visibility condition | Source |
|---|---|---|---|
| `⏰ Next` | `Next HH:MM` (if today) or `Next Mon DD, HH:MM` (if a future day) | There is ≥1 match **in the current filtered set**. If filters cleared the set (or there are no matches in the horizon at all) — chip is hidden. | Minimum `match.start_time` among matches that pass the active sheet filters (Distance, Time of day, Game size, Spots left, Price, Field status), within the 21-day horizon after `now()` (horizon defined in [global.md](./pitchup-spec-global.md), "Timezones & date ranges") |

> **The chip is always consistent with what is on the map.** It is computed from the same set drawn as pins. If the user set Game size=7 — `Next` shows the nearest 7-a-side match; the tap will fly to a pin already visible on the map. The alternative (computing from all matches, ignoring filters) would produce "chip shows a match not on the map" — a UX bug.

> **Why v1 = one chip, not three.** On `/map`, info chips are justified only because they compensate for the absence of a sorted list — `Next` solves 80% of the scenario ("where can I play tonight"). `Closest` and `Last spots` are intentionally deferred to v1.1: adding a chip takes 1 hour; removing it from the strip if it performs poorly is more painful. Better to wait for user signal first.

**Chip tap behavior:**

Algorithm: compute the matches satisfying the chip's criterion (for `Next` this is **one** match — the earliest after `now()` in the filtered set; if `start_time` is tied, all tied matches are included).

- **Result = 1 match:**
  1. The map smoothly centers on that match's pin (`map.flyTo` with zoom ≥ 15, animation ≈300ms).
  2. The same bottom-sheet with the MatchCard opens as when tapping a pin (see "Pins" below). The user stays on `/map`; closing the sheet returns to the map.
  3. The centered pin briefly shows a pin pulse (≈600ms) — a visual link "chip → this pin".

- **Result = N > 1 matches** (tied `start_time`, rare case):
  1. The map does not center (there are multiple tied pins — no single target to fly to).
  2. A bottom-sheet opens with the list of MatchCards sorted by `start_time` ASC. Tapping a card → `/matches/:id` (same behavior as the multi-pin sheet).

- **Result = 0 matches:** the chip is hidden in this situation (see table above), so this case cannot occur.

**What a chip tap does NOT do:**
- Does not change the URL (the sheet is transient state, same as a pin tap).
- Does not filter or dim other pins on the map.
- Does not redirect to `/games` or `/matches/:id`.
- Does not toggle — the chip has no "active" state; a repeat tap = repeat fly-to + same sheet.

**Pins:** number = free slots, red = full. Cancelled and In progress matches are not shown on the map — only Open / Almost full / Full.

**Tap on a pin** → bottom-sheet with all upcoming matches at that venue within the 21-day horizon (Open / Almost full / Full only), **sorted by `start_time` ASC** — nearest match on top. Tap on a card → `/matches/:id`. **Swipe up:** if the sheet contains one match — navigates to `/matches/:id`; if multiple — only expands the sheet to full height (no navigation).

**21-day horizon — unified rule for all `/map` subsystems.** Applied consistently to pins, venue sheet, and the Next chip; symmetric with the day picker on `/games`. Defined in [global.md](./pitchup-spec-global.md), "Timezones & date ranges" (`prague_range(today_prague(), today_prague() + 20)`).

**`[📍 My location]` button** (bottom-right):
- **Location is set** (GPS or manual pin) → centers the map on the saved coordinates.
- **Location not set** → opens the Location modal (see below).

**Location modal** (lives on `/map`, overlaid on the map):

Appears:
- On tap of `[📍 My location]` when location is not set.
- Automatically when opening `/map?pickLocation=true` (navigated from the Distance CTA in the `/games` sheet).

Three options:
| Button | Action |
|---|---|
| `[📍 Use my location]` | Calls `navigator.geolocation.getCurrentPosition()`. **Allowed** → saves `{lat, lng, source: 'gps'}` to localStorage, closes the modal. **Denied** (any denial — first, repeat, persistent denial) → modal **stays open**; an inline hint appears inside: `"GPS blocked — try Place on map, or enable location in browser settings."` The `[📍 Use my location]` button stays active (the user can retry — if the denial was not persistent, the prompt will reappear; if it was a persistent denial, the browser silently returns an error and the hint renders again). The `[📌 Place on map]` button is available as an alternative. The modal does not auto-close on GPS denial — consistent with the hint "what to do next", so the user is not left without guidance. |
| `[📌 Place on map]` | Closes the modal, activates pick-location mode (see below). Tap = `history.replaceState` of the modal entry (replace, not pop+push) — one entry in the history stack at all times. |
| `[Cancel]` | Closes the modal without changes — the currently saved location (if any) is untouched. User stays on `/map` (even if they arrived via `?pickLocation=true` — there is no auto-return to `/games`, see the Distance section). |

**Pick-location mode** (manual location placement):

Activated by `[📌 Place on map]` in the Location modal.
- A banner at the top of the map: `"Pan to your area, then confirm"` (thin strip, does not obscure the map).
- A fixed crosshair/pin in the center of the screen (does not move — the user pans the map beneath it).
- The `[📍 My location]` button and location status chip are **hidden** during this mode — the crosshair is the only interaction point.
- Sticky footer at the bottom: `[Use this location]` (primary) + `[Cancel]` (ghost).
- `[Use this location]` → saves the current viewport center as `{lat, lng, source: 'manual'}` to localStorage. No expiry — persists until replaced by a new location. Exits the mode, stays on `/map` (no auto-return to `/games` even if arrived via `?pickLocation=true`).
- `[Cancel]` → exits the mode without changes, stays on `/map`.

**Hardware back / swipe-back** (Android back, iOS edge-swipe, browser back):
- Opening the Location modal → pushes a history entry. Back = `[Cancel]` on the modal (modal closes, user stays on `/map`).
- Entering pick-location mode → pushes a history entry. Back = `[Cancel]` for the mode (exit without changes, user stays on `/map`).
- Closing via UI control (`[Cancel]`, tap outside the modal, `[Use this location]`) → programmatic `history.back()` to pop the entry. This ensures the back button continues to work naturally afterward (next back = leave `/map`).
- If both are stacked (modal → `[📌 Place on map]` → pick-location mode), entries stack: first back = exit pick-location mode (modal is already gone, it closed on transition); second back = leave `/map`.

**Location status chip** (when location is set):

Shown in the bottom-right corner of the map, above the `[📍 My location]` button:
- GPS source: `📍 GPS`
- Manual source: `📌 Manual`
- Tap → re-opens the Location modal (to change the method or update the location).
- Chip is hidden if location is not set.

**Filter sync with `/games`:** sheet filters (`?distance=&time=&size=&spots=&free=&booked=`) are carried between tabs via URL. **`?date=` is not applied on `/map`** — the map shows all upcoming matches without a day filter. When navigating `/games → /map` the `?date=` param is dropped. When navigating `/map → /games` the default applies (today). The search string is ephemeral — not written to the URL, lost on tab switch.

**`?pickLocation=true`** — a utility param, set only when navigating from the `[Set location]` CTA in the `/games` sheet. When `/map` opens with this param, the Location modal opens automatically. If the location is **already** set in localStorage — the modal opens anyway (useful for changing the method or updating the manual pin). The param is removed from the URL immediately after the modal opens (not persistent). **No auto-return to `/games`** — after setting the location (or tapping Cancel) the user stays on `/map` and returns via BottomNav.

**Geolocation & location storage:**
- Coordinates are stored in localStorage as `{lat, lng, source: 'gps' | 'manual'}` — **no expiry**, persists until explicitly replaced (new GPS request or new manual pin).
- GPS permission request (`getCurrentPosition`) happens only through the Location modal — not automatically on page load.
- GPS denial → Location modal stays open, `[📍 My location]` remains active (can retry, or choose `[📌 Place on map]`). The Distance section in the `/games` sheet shows the `[Set location]` CTA until a location is set by any method.
- Distance calculation — Haversine distance in SQL (no PostGIS).
- venues store `lat`, `lng` in the DB (filled by admin).

**Controls:**
| Element | Action |
|---|---|
| Map pin | bottom-sheet with match preview(s) |
| MatchCard in bottom-sheet | → /matches/:id |
| `[⚙]` (top bar) | open "More filters" bottom-sheet (same as on `/games`, without date filter) |
| `[+ New match]` (top bar) | → /matches/new (guest → /login?callbackUrl=/matches/new) |
| Info chip `⏰ Next` | centers the map on the nearest match's pin + opens bottom-sheet with MatchCard (if `start_time` is tied — sheet with list). See "Chip tap behavior" above. |
| `[📍 My location]` | Location set → centers the map. Not set → opens Location modal. |
| Location modal `[📍 Use my location]` | Requests GPS permission, saves to localStorage |
| Location modal `[📌 Place on map]` | Activates pick-location mode |
| Location modal `[Cancel]` | Closes without changes |
| `[Use this location]` (pick-location mode) | Saves viewport center as manual pin, exits the mode |
| Location status chip | Re-opens the Location modal (change method / update location) |
| BottomNav: Games | → /games (sheet filters synced via URL without `?date=`; info chips are NOT carried over — they don't exist on /games; date defaults to today) |

**States:**
- **Loading:** map renders immediately, pins load asynchronously — skeleton placeholder above pins.
- **Empty (no matches in the system in the next 21 days):** small notification "No upcoming matches" overlaid on the map.
- **Empty (filters removed all matches):** notification "No matches match your filters" overlaid on the map with `[Reset filters]`.
