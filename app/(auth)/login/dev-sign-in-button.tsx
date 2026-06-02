/**
 * MODULE: app.(auth).login.dev-sign-in-button
 * PURPOSE: Dev-only auth bypass button. Calls the `dev` Credentials provider
 *          (registered in auth-config.ts only when NODE_ENV !== "production")
 *          with a hard-coded googleSub passed in from the server-rendered
 *          /login page. Never rendered in prod (the parent gates it).
 * LAYER: interfaces (client)
 * DEPENDENCIES: next-auth/react
 */
"use client";

import { signIn } from "next-auth/react";

interface DevSignInButtonProps {
  readonly googleSub: string;
  readonly callbackUrl?: string;
}

export function DevSignInButton({ googleSub, callbackUrl }: DevSignInButtonProps) {
  return (
    <button
      type="button"
      onClick={() => {
        void signIn("dev", {
          googleSub,
          callbackUrl: callbackUrl ?? "/my-matches",
        });
      }}
      className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-btn border border-dashed border-border bg-bg-surface text-[14px] font-medium text-text-secondary transition-colors hover:bg-bg-muted"
    >
      🔧 Dev login (bypass OAuth)
    </button>
  );
}
