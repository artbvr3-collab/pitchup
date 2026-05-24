/**
 * MODULE: app.api.auth.nextauth.route
 * PURPOSE: Auth.js v5 catch-all route handler. Delegates GET/POST to the
 *          NextAuth() singleton — covers `/api/auth/signin`,
 *          `/api/auth/signout`, `/api/auth/callback/google`, `/api/auth/session`,
 *          and the rest of the Auth.js endpoints.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/infrastructure/auth.ts
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "Authentication".
 */
import { handlers } from "@/src/auth/infrastructure/auth";

export const { GET, POST } = handlers;
