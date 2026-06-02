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
  // Layer 5.5 realtime chat (Ably) — both optional. Absent → the chat realtime
  // publisher resolves to the no-op adapter and the client subscribe hook
  // no-ops; chat still works on polling. See ADR-0005.
  //   - ABLY_API_KEY: server-side full key, used by AblyChatRealtimePublisher
  //     for fan-out. The client NEVER reads this.
  //   - NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY: subscribe-only key, shipped in the
  //     client bundle. The hook reads it via process.env directly (this file
  //     is server-only); declared here for startup validation + .env.example.
  ABLY_API_KEY: z.string().optional(),
  NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY: z.string().optional(),
  // Dev-only auth bypass. When set AND NODE_ENV !== "production", the /login
  // page renders a "Dev login" button that signs the holder in as the user
  // whose `googleSub` equals this value. Hard-gated in auth-config.ts: the
  // Credentials provider isn't even instantiated in production builds.
  DEV_LOGIN_GOOGLE_SUB: z.string().optional(),
  // Venue photo storage (Cloudflare R2, S3-compatible) — all optional. Absent
  // → `isPhotoStorageConfigured()` is false, the admin upload route returns 503
  // `photo_storage_unconfigured`, and the admin can still paste a Photo URL by
  // hand. Validated as a group in src/shared/storage/r2.ts (not here — they're
  // optional to boot, same convention as Resend/Ably). See that module.
  //   - R2_ACCOUNT_ID: Cloudflare account id (builds the S3 endpoint host).
  //   - R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY: an R2 API token's credentials.
  //   - R2_BUCKET: target bucket name (e.g. "pitchup-venues").
  //   - R2_PUBLIC_BASE_URL: public origin the bucket is served from (r2.dev URL
  //     or a custom domain) — the stored `photoUrl` is `${base}/${key}`.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().url().optional(),
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
