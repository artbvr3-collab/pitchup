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
import Google from "next-auth/providers/google";

// Force startup-time env validation. Auth.js v5 reads AUTH_GOOGLE_ID,
// AUTH_GOOGLE_SECRET, AUTH_SECRET from process.env on its own — we import
// `env` purely to fail fast with a readable message if any are missing.
import "@/src/shared/config/env";
import { asGoogleSub } from "../domain/user";
import { userRepository } from "./repositories";

const THREE_HUNDRED_THIRTY_THREE_DAYS_IN_SECONDS = 333 * 24 * 60 * 60;

export const authConfig: NextAuthConfig = {
  providers: [Google],
  session: {
    strategy: "jwt",
    maxAge: THREE_HUNDRED_THIRTY_THREE_DAYS_IN_SECONDS,
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ profile }) {
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
    async jwt({ token, account, profile }) {
      // On the first sign-in `account` and `profile` are present. On
      // subsequent requests the existing token is returned unchanged.
      if (account?.provider === "google" && profile && typeof profile.sub === "string") {
        token.googleSub = profile.sub;
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
