/**
 * MODULE: shared.config.env
 * PURPOSE: Validate environment variables at startup via Zod. Process fails
 *          to boot if any required variable is missing or malformed —
 *          there are no silent defaults.
 * LAYER: shared / infrastructure
 * DEPENDENCIES: zod
 * CONSUMED BY: src/shared/db/prisma.ts (via @prisma/client reading
 *              process.env.DATABASE_URL), src/auth/infrastructure/auth-config.ts
 * INVARIANTS:
 *   - The only place process.env is read directly. All other code imports `env`.
 *   - Schema grows as layers add variables. Keep .env.example in sync.
 * RELATED DOCS: docs/ARCHITECTURE.md §13 (Configuration).
 */
import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  // Layer 7b email (all optional — the app boots without them; the email
  // sender then resolves to the console adapter). See ADR-0004.
  //   - NEXT_PUBLIC_APP_URL: base for the `/matches/:id` deep link in bodies.
  //   - EMAIL_TRANSPORT: "resend" opts into real sends; anything else = console.
  //   - RESEND_API_KEY / RESEND_FROM: required IFF EMAIL_TRANSPORT=resend
  //     (validated at composition time, not here — they're optional to boot).
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  EMAIL_TRANSPORT: z.enum(["resend", "console"]).optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console -- startup-time fatal: must surface before logger exists.
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed. See .env.example.");
}

export const env: Env = parsed.data;

/**
 * Base URL for deep links built into outbound emails (`/matches/:id`). Dev
 * falls back to localhost so console-sender output is still clickable. Trailing
 * slashes are trimmed so link construction can join with a single `/`.
 */
export const appBaseUrl: string = (
  env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
).replace(/\/+$/, "");
