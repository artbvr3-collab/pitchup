/**
 * MODULE: auth.infrastructure.next-auth (module augmentation)
 * PURPOSE: Extend Auth.js v5 types with PITCHUP-specific JWT/session fields.
 *          See docs/spec/pitchup-spec-global.md → "What goes in the JWT".
 * LAYER: infrastructure (types only)
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "Authentication".
 */
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    /**
     * Google `sub` claim — the primary key by which middleware and
     * `requireAuth()` look up the user row. Optional in the type because
     * a malformed JWT may omit it; consumers must validate before use.
     */
    googleSub?: string;
    user?: DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    googleSub?: string;
  }
}
