/**
 * MODULE: notifications.infrastructure.console-email-sender
 * PURPOSE: Dev / default `EmailSender` adapter — logs the message to the
 *          console instead of sending it. This is what runs whenever
 *          `EMAIL_TRANSPORT` is not `resend`, so a developer never sends real
 *          mail by accident (ADR-0004 "Dev-vs-prod routing").
 * LAYER: infrastructure
 * DEPENDENCIES: ../domain/email-sender
 * CONSUMED BY: ./email-sender (transport selection)
 * INVARIANTS:
 *   - Never throws — the console is always available. Mirrors a successful
 *     send so callers exercise the same happy path in dev.
 */
import type { EmailMessage, EmailSender } from "../domain/email-sender";

export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    const indented = message.text.replace(/\n/g, "\n  ");
    // eslint-disable-next-line no-console -- dev transport: the console IS the sink.
    console.log(
      `\n[email:console] → ${message.to}\n  subject: ${message.subject}\n  ${indented}\n`,
    );
  }
}
