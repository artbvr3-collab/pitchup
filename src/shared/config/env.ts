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
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console -- startup-time fatal: must surface before logger exists.
  console.error("❌ Invalid environment variables:", parsed.error.flatten().fieldErrors);
  throw new Error("Environment validation failed. See .env.example.");
}

export const env: Env = parsed.data;
