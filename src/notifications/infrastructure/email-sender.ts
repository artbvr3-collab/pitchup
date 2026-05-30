/**
 * MODULE: notifications.infrastructure.email-sender
 * PURPOSE: Construct the singleton `EmailSender` the composition roots inject
 *          into the three email-producing services. Transport is chosen by
 *          `EMAIL_TRANSPORT` (ADR-0004): `resend` → real sends (requires key +
 *          from, validated here); anything else → console adapter. Dev thus
 *          defaults to console even with a key present.
 * LAYER: infrastructure (composition-adjacent — reads validated `env`)
 * DEPENDENCIES: src/shared/config/env, ./console-email-sender, ./resend-email-sender
 * CONSUMED BY: src/notifications/composition.ts,
 *              src/match_lifecycle/composition.ts, scripts/run-cron.ts
 * INVARIANTS:
 *   - `EMAIL_TRANSPORT=resend` with a missing RESEND_API_KEY / RESEND_FROM is a
 *     hard startup error — no silent half-config (mirrors env.ts's fail-fast).
 */
import { env } from "@/src/shared/config/env";

import type { EmailSender } from "../domain/email-sender";
import { ConsoleEmailSender } from "./console-email-sender";
import { ResendEmailSender } from "./resend-email-sender";

function buildEmailSender(): EmailSender {
  if (env.EMAIL_TRANSPORT === "resend") {
    if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
      throw new Error(
        "EMAIL_TRANSPORT=resend requires RESEND_API_KEY and RESEND_FROM. " +
          "Unset EMAIL_TRANSPORT for the console adapter in dev.",
      );
    }
    return new ResendEmailSender(env.RESEND_API_KEY, env.RESEND_FROM);
  }
  return new ConsoleEmailSender();
}

export const emailSender: EmailSender = buildEmailSender();
