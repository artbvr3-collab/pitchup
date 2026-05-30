/**
 * MODULE: notifications.domain.email-sender
 * PURPOSE: Transport port for outbound email. The domain owns the contract;
 *          infrastructure provides adapters (Resend in prod, Console in dev).
 *          The port is deliberately DUMB — it sends a fully-built message and
 *          knows nothing about users, the `email_notifications` gate, or body
 *          templates. Gating lives in `emailGateOpen` (./email-bodies); copy
 *          lives in the pure builders there.
 * LAYER: domain
 * DEPENDENCIES: none (pure types)
 * CONSUMED BY:
 *   - src/notifications/infrastructure/{resend,console}-email-sender.ts (adapters)
 *   - src/match_lifecycle/application/{approve-join-request,kick-player}-service.ts
 *   - src/notifications/application/morning-reminder-service.ts
 *   - tests (FakeEmailSender)
 * INVARIANTS:
 *   - `send` either resolves (accepted by the provider) or throws. Callers
 *     decide what a throw means: the morning cron lets it roll back the ledger
 *     tx (→ retry next tick); approve/kick catch + log (best-effort, the action
 *     already committed). See ADR-0004 "Send semantics".
 *   - Plain-text only in v1 (`text`). HTML bodies are a later, local change
 *     behind the same port.
 * RELATED DOCS: docs/adr/0004-resend-email-with-channel-specific-send-semantics.md,
 *               docs/spec/pitchup-spec-global.md → "Notifications".
 */

export interface EmailMessage {
  /** Recipient address (already gated + resolved by the caller). */
  readonly to: string;
  readonly subject: string;
  /** Plain-text body. */
  readonly text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}
