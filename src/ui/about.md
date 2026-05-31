# bounded context: ui

**Purpose.** Shared UI kit — design tokens and reusable React components. Cross-cutting; every feature page composes from here. Lives as a bounded context (not under `shared/`) because it has its own domain language (tokens, variants, accessibility primitives) and a non-trivial surface area.

**Core entities.**
- `tokens.ts` — typed mirror of the CSS custom properties defined in `app/globals.css`. The source of truth for design values is `mockups/match.html` (canonical light palette, anchored 2026-05-24); `tokens.ts` only types them for autocomplete.
- `components/` — one file per primitive: `button`, `card`, `chip`, `input`, `stepper`, `switch`, `checkbox`. More land as new mockups are absorbed.
- `lib/cn.ts` — `clsx` + `tailwind-merge` helper.

**Invariants.**
- Never inline raw hex outside `tokens.ts` and `tailwind.config.ts`. New token → add there first.
- Container width: `max-w-[375px]`, centered, mobile safe-area. Not 480, not responsive.
- Server Component by default; `'use client'` only for components with Radix internals or local state.
- Every new component lands in `src/ui/components/`, then gets consumed by a feature screen.

**External dependencies.** Radix UI (Switch, Checkbox, Slot), `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`.

**Related docs.** `docs/ARCHITECTURE.md` §11, `mockups/match.html` (token header comment).
