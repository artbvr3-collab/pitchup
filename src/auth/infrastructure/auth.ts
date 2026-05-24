/**
 * MODULE: auth.infrastructure.auth
 * PURPOSE: NextAuth() singleton. Exports the Auth.js v5 handlers + helpers
 *          (`auth`, `signIn`, `signOut`) for use by the route handler,
 *          Server Components, Server Actions, and middleware.
 * LAYER: infrastructure
 * DEPENDENCIES: next-auth, ./auth-config
 * CONSUMED BY: app/api/auth/[...nextauth]/route.ts (handlers),
 *              middleware.ts (auth), Server Components / Actions (auth, signIn).
 * INVARIANTS:
 *   - Exactly one NextAuth() invocation per process.
 * RELATED DOCS: docs/ARCHITECTURE.md §9.
 */
import NextAuth from "next-auth";
import { authConfig } from "./auth-config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
