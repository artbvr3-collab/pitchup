# Spec directory — language rules

**The spec is English-only.** All files in `docs/spec/*.md` (top level) are in English. When editing, extending, or creating spec files here, write in English.

## Layout

| Path | Language | Status |
|---|---|---|
| `docs/spec/*.md` | **English** | Active source of truth |
| `docs/spec/ru/*.md` | Russian | **Frozen archive** — do not modify |
| `docs/spec/_translation-glossary.md` | Bilingual (RU↔EN) | Translator's reference. Update only when adding terms. |

## Rules

1. **Never write Russian into `docs/spec/*.md`** (top level). If the user gives you a request in Russian, the spec content you produce here must still be in English. You can reply to the user in Russian — only the file content stays English.
2. **Do not read `docs/spec/ru/*.md`.** The Russian files are a frozen historical archive — they hold no information that isn't already in the English spec (the EN files are the source of truth, the RU was translated *from*). Reading RU spec files wastes tokens and risks contaminating output with stale terminology. **Skip them by default.** Only read a RU file if the user explicitly asks ("посмотри в ru-версии", "сравни с RU", etc.) — never on your own initiative for "context" or "verification".
3. **Do not modify `docs/spec/ru/*.md`** — frozen. If the user asks to update the spec, edit the English version.
4. **Keep terminology consistent with `_translation-glossary.md`.** When introducing a new domain term, add it to the glossary first.
5. **Cross-file links** in spec files use bare filenames (`./pitchup-spec-match.md`) — they resolve within `docs/spec/`. Do not prefix with `en/` or `ru/`.

## Disputed-term reminders (from glossary §9)

These pairs trip people up — keep them straight:

- `rejected` (DB/API, `JoinRequest.status`) vs `declined` (UI label, poll payload `my_status`)
- `slot` (technical, Slot math, capacity) vs `spot` (only inside final UI strings like `"5 spots open"`)
- `captain` (role) vs `organizer` (public-facing label, e.g. "Organizer:")
- `Watch` (DB/API) / `Notify me` (UI label) / `watching` (status) — **never** "watcher"
- `crew` (the array) / `stub player` (one entry) — **never** "crew member"
- `[Manage match]` (CTA button) vs `captain sheet` (the bottom-sheet it opens)
- `Ended` (match status) vs `Section Past` (`/my-matches` section)
- `in-app inbox` (concept) vs `Updates panel` (UI component)
- `Hide text` (button label) vs `content moderation` / `hide flag` (in prose)
