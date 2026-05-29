# shared/http

Cross-cutting helpers for HTTP route handlers. Tiny by design — only landing zone for primitives that more than one `app/api/.../route.ts` needs.

Current contents:
- `parseSince(raw)` — lenient ISO timestamp parser for `?since=` query params used by both poll endpoints (`/api/matches/:id/state`, `/api/updates/state`). Missing / malformed → `null` (caller falls back to "full state"); never throws. Matches the broader "polling endpoints don't 4xx on bad query strings" convention shared with the Discover URL parser.
