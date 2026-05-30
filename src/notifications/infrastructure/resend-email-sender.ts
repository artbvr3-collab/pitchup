/**
 * MODULE: notifications.infrastructure.resend-email-sender
 * PURPOSE: Production `EmailSender` adapter backed by the Resend HTTP API
 *          (ADR-0004). Translates an `EmailMessage` into a Resend send and
 *          surfaces provider errors as a thrown `Error` so callers can apply
 *          their channel-specific failure policy (cron rolls back + retries;
 *          approve/kick catch + log).
 * LAYER: infrastructure
 * DEPENDENCIES: resend (SDK), ../domain/email-sender
 * CONSUMED BY: ./email-sender (transport selection)
 * INVARIANTS:
 *   - The Resend SDK does NOT throw on a rejected send — it resolves to
 *     `{ data, error }`. We MUST inspect `error` and throw, otherwise a failed
 *     send would look successful and the cron ledger would never retry.
 *   - `from` is a verified Resend sender (e.g. "PITCHUP <noreply@pitchup.online>");
 *     supplied via RESEND_FROM, validated at composition time.
 */
import { Resend } from "resend";

import type { EmailMessage, EmailSender } from "../domain/email-sender";

export class ResendEmailSender implements EmailSender {
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    if (error) {
      // `error` is Resend's ErrorResponse (a plain object). Stringify it rather
      // than assume specific fields — the exact shape varies across SDK minors.
      throw new Error(`Resend send failed: ${JSON.stringify(error)}`);
    }
  }
}
