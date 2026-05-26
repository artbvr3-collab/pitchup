# shared/time

**Purpose.** Cross-cutting time utilities. Currently: Prague-day ↔ UTC
primitives (`prague_day`, `prague_range`, `today_prague`) defined by the
spec as the canonical entry points for any "by day" filter, picker bound,
or horizon. Centralising them here keeps `/games`, `/map`, the creation
guard, and reminders consistent across DST boundaries.

**Status.** Established at Layer 2.5; expanded as later layers need more
(e.g. relative-time labels, cron-time helpers).

**Related docs.** `docs/spec/pitchup-spec-global.md` → "Timezones & date
ranges".
