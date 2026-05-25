/**
 * MODULE: app.(auth).login.google-sign-in-button
 * PURPOSE: Client island that triggers the Google OAuth flow via Auth.js v5.
 *          Wrapped in a separate file so the surrounding /login page can stay
 *          a Server Component and pre-render.
 * LAYER: interfaces (client)
 * DEPENDENCIES: next-auth/react
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "/login".
 */
"use client";

import { signIn } from "next-auth/react";

interface GoogleSignInButtonProps {
  readonly callbackUrl?: string;
}

export function GoogleSignInButton({ callbackUrl }: GoogleSignInButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        void signIn("google", callbackUrl ? { callbackUrl } : undefined);
      }}
      className="flex h-14 w-full items-center justify-center gap-3 rounded-btn bg-green-dark text-[16px] font-semibold text-text-inverted shadow-btn transition-colors hover:bg-green-mid active:scale-[0.99]"
    >
      <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-text-inverted text-[13px] font-bold text-green-dark">
        G
      </span>
      Sign in with Google
    </button>
  );
}
