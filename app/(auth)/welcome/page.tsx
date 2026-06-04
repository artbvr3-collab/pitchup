/**
 * MODULE: app.(auth).welcome.page
 * PURPOSE: One-screen onboarding. Pre-fills the name input from the Google
 *          OAuth payload (`session.user.name`), shows the read-only avatar,
 *          and submits to `completeOnboardingAction` which writes the first
 *          (and only) row in `users` for this person and redirects to
 *          `callbackUrl` or `/my-matches`. TopBar carries a `Sign out` link
 *          (the only escape hatch for users who change their mind before
 *          finishing onboarding). BottomNav is hidden (spec).
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/infrastructure/auth, next/navigation, ./actions
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "/welcome — Onboarding".
 */
import { redirect } from "next/navigation";

import { auth } from "@/src/auth/infrastructure/auth";

import { completeOnboardingAction, signOutAction } from "./actions";

interface WelcomePageProps {
  readonly searchParams: Promise<{ callbackUrl?: string }>;
}

export default async function WelcomePage({ searchParams }: WelcomePageProps) {
  const params = await searchParams;
  const session = await auth();
  // Middleware already redirects guests away from /welcome; this is the
  // defense-in-depth fallback for direct page renders.
  if (!session?.googleSub) {
    redirect("/login");
  }

  const prefillName = session.user?.name ?? "";
  const avatarUrl = session.user?.image ?? "";
  const callbackUrl = params.callbackUrl ?? "";

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex min-h-[32px] items-center justify-between">
        <Wordmark />
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-[14px] font-medium text-text-secondary underline decoration-border underline-offset-2 hover:text-text-primary"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-12 flex flex-col items-center text-center">
        <h1 className="text-[28px] font-extrabold tracking-[-0.02em] text-green-dark">
          Welcome to PITCHUP
        </h1>

        <div className="mt-8">
          {avatarUrl ? (
            // Avatar from Google. read-only in v1 (no file storage —
            // see "Out of scope for v1" in spec).
            // eslint-disable-next-line @next/next/no-img-element -- Google CDN URL, not a Next-routed image.
            <img
              src={avatarUrl}
              alt=""
              width={88}
              height={88}
              referrerPolicy="no-referrer"
              className="h-[88px] w-[88px] rounded-full border border-border bg-bg-card object-cover"
            />
          ) : (
            <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full border border-border bg-bg-card text-[28px] font-bold text-text-muted">
              {prefillName.charAt(0).toUpperCase() || "?"}
            </div>
          )}
        </div>
      </section>

      <form action={completeOnboardingAction} className="mt-8 flex flex-col">
        <label htmlFor="name" className="text-[13px] font-medium text-text-secondary">
          Your name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          defaultValue={prefillName}
          required
          maxLength={100}
          autoComplete="name"
          className="mt-2 h-12 rounded-btn border border-border bg-bg-card px-4 text-[16px] text-text-primary focus:border-border-focus focus:outline-none"
        />
        <input type="hidden" name="callbackUrl" value={callbackUrl} />

        <div className="min-h-8 flex-1" />

        <button
          type="submit"
          className="mt-8 flex h-14 w-full items-center justify-center rounded-btn bg-green-dark text-[16px] font-semibold text-text-inverted shadow-btn transition-colors hover:bg-green-mid active:scale-[0.99]"
        >
          Get started &rarr;
        </button>
      </form>

      <p className="mt-[14px] text-center text-[12px] leading-[1.5] text-text-muted">
        You can change your name and contact info later in your profile.
        <br />
        Your email stays private &mdash; used only for match notifications,
        never shown to others.
      </p>
    </main>
  );
}

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-[3px] text-[19px] font-black leading-none tracking-[-0.03em]">
      <span className="text-green-dark">PITCH</span>
      <span className="rounded-badge bg-lime px-[7px] pt-[2px] pb-[3px] text-lime-text">
        UP
      </span>
    </span>
  );
}
