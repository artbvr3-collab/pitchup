# ADR-0004: Resend for transactional email, with channel-specific send semantics

- **Status:** Accepted
- **Date:** 2026-05-30
- **Deciders:** Pr1ce (owner) + Claude (Layer 7b email)

## Context

Layer 7 ships three notification channels: in-app inbox (done, 7a), browser
Notification API (done, 7b-browser), and **email** (this layer). The spec
(`docs/spec/pitchup-spec-global.md` → "Notifications") keeps email a *narrow*
channel — only three events ever produce a mail:

| Event | Recipient |
|---|---|
| ✓ approved | the player whose request was accepted |
| ✗ kicked | the removed player |
| 💬 morning-of-match reminder (today / tomorrow) | captain + every accepted player |

Everything else (rejected-pending, match-cancelled, spot-opened, match-updated)
is **in-app only** — global.md §309 is explicit: "Rejected pending and match
cancelled are **not sent by email**." A single per-user toggle
`users.email_notifications` gates the whole channel; the in-app inbox is never
gated.

Two constraints shape the design:

1. **We need a transport.** No SMTP infra; we want a hosted API with a Node SDK,
   a free dev tier, and domain-based `from`. Candidates: Resend, Postmark,
   AWS SES, Nodemailer+SMTP.
2. **The three events live in two very different execution contexts:**
   - approve / kick are *interactive* HTTP actions inside a `withMatchLock`
     advisory-locked transaction (`src/match_lifecycle/application/*`). They are
     **not idempotent** and **nothing retries them**.
   - the morning reminder is a *cron* (`MorningReminderService`) whose
     per-`(match,user)` work is wrapped in `withTransaction` and gated by the
     `reminder_sent` ledger (composite-PK idempotency). A failed pair is simply
     retried on the next cron tick.

The morning service already carries a `// TODO(Layer 7b email)` marker *inside*
its ledger transaction. The naïve reading ("put every send inside the existing
tx") is correct for the cron but **wrong for approve/kick** — see Decision.

## Decision

**Use Resend** as the email transport, behind an `EmailSender` domain port
(`src/notifications/domain/email-sender.ts`) with two adapters, and apply
**channel-specific send semantics** rather than one blanket rule.

### Transport — Resend, behind a port

- **Option A — Nodemailer + SMTP:** rejected — we'd own deliverability, SPF/DKIM
  plumbing, and a relay; more ops than a one-person project wants.
- **Option B — AWS SES:** rejected — cheapest at scale but the heaviest setup
  (sandbox removal, IAM) for v1 volumes that are tiny.
- **Option C — Resend:** ✅ chosen — Node SDK, generous free tier, domain `from`
  (`pitchup.online`), good DX. Wrapped behind `EmailSender` so the domain never
  imports the SDK and tests use a `FakeEmailSender`.

`EmailSender.send({ to, subject, text })` is a dumb transport — it knows nothing
about users, gating, or templates. Body templates are pure builders in
`notifications/domain/email-bodies.ts`; the opt-in gate is the pure
`emailGateOpen({ emailNotifications, banned, deletedAt })`.

### Dev-vs-prod routing — explicit `EMAIL_TRANSPORT`, console is the default

`emailSender` (in `notifications/infrastructure`) is chosen at composition time:

- `EMAIL_TRANSPORT=resend` → `ResendEmailSender` (requires `RESEND_API_KEY` +
  `RESEND_FROM`; throws at startup if absent — no silent half-config).
- anything else (incl. unset) → `ConsoleEmailSender`, which `console.log`s the
  message instead of sending.

So **dev defaults to console even if a key is present** — you only get real
sends when you opt in with `EMAIL_TRANSPORT=resend`. Production (Layer 10) sets
the flag + key. This matches the spec's "user's own risk" toggle without ever
surprising a developer with live mail.

### Send semantics — per channel, NOT one rule

- **Morning reminder (cron, idempotent): send INSIDE the ledger tx.** The send
  sits where the marker is: after the `reminder_sent` INSERT + inbox INSERT,
  before commit. A throw rolls back the ledger row, so the *next* cron tick
  retries the whole pair — the ledger gives us at-least-once with a near-exactly
  -once shape. Holding the (lock-free) tx open across the Resend HTTP call is
  acceptable for a low-volume background job. Recipients' emails/flags are
  batch-resolved once per match (`UserRepository.findByIds`) outside the
  per-pair tx.
- **Approve / kick (interactive, non-idempotent): send AFTER the tx commits,
  best-effort.** The blanket "send inside the tx" rule is rejected here:
  - there is **no retrier** — if the send threw inside `withMatchLock`, the
    whole approve/kick would roll back and the captain's click would fail on a
    transient Resend hiccup. The in-app inbox row (the reliable channel) would
    be lost too.
  - it would hold the **advisory lock open across an HTTP call**, serializing
    every mutation on that match behind a third-party's latency.

  Instead the service commits the domain change + inbox row under the lock, then
  resolves the recipient and sends **outside** the lock, wrapped in
  try/catch — a failure is logged and swallowed. Delivery is at-most-once; the
  in-app inbox remains the source of truth. (Owner confirmed this over the
  marker's wording, 2026-05-30.)

### Gate

`emailGateOpen` = `emailNotifications && !banned && deletedAt === null`. The
in-app inbox INSERT is always unconditional; only the email send consults the
gate. Banned / soft-deleted recipients never get mail (their account is gone).

## Consequences

- **Easier:** one transport seam (`EmailSender`) means swapping providers or
  adding HTML bodies later is local. Tests stay pure (`FakeEmailSender`, no
  network). Dev never sends real mail by accident.
- **Harder / obligations:**
  - New dependency `resend`; new env vars `EMAIL_TRANSPORT`, `RESEND_API_KEY`,
    `RESEND_FROM`, `NEXT_PUBLIC_APP_URL` (for the `/matches/:id` deep link in
    bodies). `.env.example` + `shared/config/env.ts` updated.
  - approve/kick now do a post-commit `UserRepository.findById` + send — one
    extra read on the success path. Acceptable; it is off the locked critical
    section.
  - The morning send-inside-tx accepts a rare duplicate: if Resend succeeds but
    the commit then fails, the ledger rolls back and the next tick re-sends.
    For a "match today" nudge a rare double is harmless; the alternative
    (send-after-commit) would *drop* mail on send failure, which is worse.
  - Production cron scheduling itself is still **Layer 10** (VPS). This layer
    only makes the send happen when the cron is invoked.

## References

- Spec sections this affects: `docs/spec/pitchup-spec-global.md` →
  "Notifications" (email allowlist + toggle); `docs/spec/pitchup-spec-match.md`
  → "Cron jobs → Morning-of-match reminder".
- Code files this affects: `src/notifications/domain/email-sender.ts`,
  `src/notifications/domain/email-bodies.ts`,
  `src/notifications/infrastructure/{resend,console}-email-sender.ts`,
  `src/match_lifecycle/application/{approve-join-request,kick-player}-service.ts`,
  `src/notifications/application/morning-reminder-service.ts`,
  `src/shared/config/env.ts`.
- Related ADRs: ADR-0002 (app-error hierarchy), ADR-0003 (repository port
  pattern — `EmailSender` mirrors it).
- External: https://resend.com/docs/send-with-nodejs
