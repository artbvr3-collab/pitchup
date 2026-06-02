/**
 * MODULE: auth.infrastructure.auth-config
 * PURPOSE: Auth.js v5 configuration object. Defines the single OAuth provider
 *          (Google), JWT-only session strategy with 333-day lifetime, and
 *          callbacks that carry `googleSub` from the OAuth profile into the
 *          session for downstream consumers (middleware, `requireAuth()`).
 * LAYER: infrastructure
 * DEPENDENCIES: next-auth, next-auth/providers/google, src/shared/config/env.ts
 *               (validates AUTH_SECRET / AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET at
 *               startup — Auth.js itself reads them from process.env directly).
 * CONSUMED BY: src/auth/infrastructure/auth.ts
 * INVARIANTS:
 *   - JWT only. NO Prisma adapter — user rows are created on `[Get started →]`
 *     in `/welcome`, not on OAuth callback (spec: "User row is created only
 *     on onboarding completion").
 *   - `session.maxAge` = 333 days (spec: "Authentication").
 *   - The `signIn` callback rejects banned / soft-deleted users by reading
 *     the `users.banned` and `users.deleted_at` columns directly (spec:
 *     "Session invalidation via users.banned / users.deleted_at"). Returning
 *     a string from `signIn` makes Auth.js redirect there *and* skip setting
 *     the session cookie — exactly what the spec demands for the banned
 *     screen.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "Authentication" +
 *               "What goes in the JWT" + "Ban / account deletion",
 *               docs/ARCHITECTURE.md §9.
 */
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

type Provider = NextAuthConfig["providers"][number];

// Force startup-time env validation. Auth.js v5 reads AUTH_GOOGLE_ID,
// AUTH_GOOGLE_SECRET, AUTH_SECRET from process.env on its own — we import
// `env` purely to fail fast with a readable message if any are missing.
import "@/src/shared/config/env";
import { asGoogleSub } from "../domain/user";
import { userRepository } from "./repositories";

const THREE_HUNDRED_THIRTY_THREE_DAYS_IN_SECONDS = 333 * 24 * 60 * 60;

// Dev-only Credentials provider that lets us sign in as an existing user by
// googleSub — bypasses the Google OAuth flow that's otherwise required in
// localhost. Gated on NODE_ENV so it cannot be instantiated in production
// builds, even if DEV_LOGIN_GOOGLE_SUB were accidentally set there.
const devProvider: Provider | null =
  process.env.NODE_ENV !== "production"
    ? Credentials({
        id: "dev",
        name: "Dev Login",
        credentials: { googleSub: { label: "googleSub", type: "text" } },
        async authorize(credentials) {
          const sub = typeof credentials?.googleSub === "string" ? credentials.googleSub : "";
          if (!sub) return null;
          const user = await userRepository.findByGoogleSub(asGoogleSub(sub));
          if (!user || user.banned || user.deletedAt !== null) return null;
          return { id: user.id, name: user.name, googleSub: sub };
        },
      })
    : null;

const providers: Provider[] = devProvider ? [Google, devProvider] : [Google];

export const authConfig: NextAuthConfig = {
  // Self-hosted behind a reverse proxy (Caddy → Cloudflare). Auth.js v5 must
  // trust the forwarded Host header; otherwise production (NODE_ENV=production)
  // rejects every request to /api/auth/* with `UntrustedHost`. `next dev`
  // auto-trusts localhost, so this only surfaces in the container / on the VPS.
  // For correct absolute callback URLs in prod, also set AUTH_URL=
  // https://pitchup.online in the VPS .env (Layer 10b/10e). See ADR-0006.
  trustHost: true,
  providers,
  session: {
    strategy: "jwt",
    maxAge: THREE_HUNDRED_THIRTY_THREE_DAYS_IN_SECONDS,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ profile, account }) {
      // Dev Credentials provider already validated the user in `authorize`
      // (incl. banned / deletedAt). Skip the Google-specific lookup here.
      if (account?.provider === "dev") return true;
      // Spec: "Session invalidation via users.banned / users.deleted_at".
      // We look the user up by googleSub on every OAuth completion. A
      // missing row is fine — it means a new user; onboarding will create
      // them. A banned row → redirect to /login?error=banned. A soft-
      // deleted row → redirect to /login. Returning a string from signIn
      // also tells Auth.js NOT to set the session cookie.
      if (!profile || typeof profile.sub !== "string") {
        return false;
      }
      const existing = await userRepository.findByGoogleSub(asGoogleSub(profile.sub));
      if (!existing) return true;
      if (existing.banned) return "/login?error=banned";
      if (existing.deletedAt !== null) return "/login";
      return true;
    },
    async jwt({ token, account, profile, user }) {
      // On the first sign-in `account` and `profile` are present. On
      // subsequent requests the existing token is returned unchanged.
      if (account?.provider === "google" && profile && typeof profile.sub === "string") {
        token.googleSub = profile.sub;
      }
      // Dev Credentials provider: `user.googleSub` was set by `authorize`.
      if (account?.provider === "dev" && user && "googleSub" in user) {
        token.googleSub = String((user as { googleSub: unknown }).googleSub);
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.googleSub === "string") {
        session.googleSub = token.googleSub;
      }
      return session;
    },
  },
};
