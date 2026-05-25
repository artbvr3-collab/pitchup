/**
 * MODULE: app.(auth).login.page
 * PURPOSE: Public sign-in / landing screen. Visual anchor: mockups/login.html
 *          (canonical, mirrored in spec § "/login"). Banned and OAuth-error
 *          states layered on top.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/infrastructure/auth.ts, next/navigation
 * RELATED DOCS: mockups/login.html, docs/spec/pitchup-spec-global.md "/login"
 *               + "Ban / account deletion".
 */
import { redirect } from "next/navigation";

import { auth } from "@/src/auth/infrastructure/auth";

import { GoogleSignInButton } from "./google-sign-in-button";

interface LoginPageProps {
  readonly searchParams: Promise<{
    callbackUrl?: string;
    error?: string;
  }>;
}

const ACCESS_DENIED_ERRORS = new Set(["AccessDenied"]);

function classifyError(error: string | undefined): "banned" | "cancelled" | "failed" | null {
  if (!error) return null;
  if (error === "banned") return "banned";
  if (ACCESS_DENIED_ERRORS.has(error)) return "cancelled";
  return "failed";
}

function safeCallbackUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  return raw;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorKind = classifyError(params.error);
  const callbackUrl = safeCallbackUrl(params.callbackUrl);

  // Signed-in users land here only via deep-link / bookmark. Bounce them out,
  // except when they arrived with ?error=banned (the banned screen replaces
  // the page entirely and must render even if a stale cookie is still around).
  if (errorKind !== "banned") {
    const session = await auth();
    if (session?.googleSub) {
      redirect(callbackUrl ?? "/my-matches");
    }
  }

  if (errorKind === "banned") {
    return <BannedScreen />;
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="flex min-h-[32px] items-center justify-between">
        <Wordmark />
        <AlphaChip />
      </header>

      <section className="mt-16">
        <h1 className="text-[42px] font-extrabold leading-[1.02] tracking-[-0.03em] text-green-dark">
          Pickup football
          <br />
          in Prague.
        </h1>
        <p className="mt-[18px] max-w-[300px] text-[16px] leading-[1.5] text-text-secondary">
          See who&rsquo;s playing this week and grab a spot. Captains approve, you show up.
        </p>
      </section>

      <ul className="mt-7 flex flex-col gap-3">
        <Bullet bold="Find a match." rest="Filter by date, format, level." />
        <Bullet bold="Tap to join." rest="Captain approves, you get notified." />
        <Bullet bold="Cash on the field." rest="No fees, no payments through the app." />
      </ul>

      <div className="min-h-8 flex-1" />

      {errorKind === "cancelled" && (
        <ErrorAlert
          tone="info"
          message="Sign-in cancelled. Try again when you&rsquo;re ready."
        />
      )}
      {errorKind === "failed" && (
        <ErrorAlert tone="warn" message="Sign-in failed. Try again." />
      )}

      <GoogleSignInButton {...(callbackUrl !== undefined ? { callbackUrl } : {})} />

      <p className="mt-[14px] text-center text-[12px] leading-[1.5] text-text-muted">
        <span className="font-medium text-text-secondary">
          Side project &mdash; no fees, no ads.
        </span>
        <br />
        By signing in you agree to the{" "}
        <a
          href="/legal/terms"
          className="text-text-secondary underline decoration-border underline-offset-2"
        >
          terms
        </a>
        .
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

function AlphaChip() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-chip bg-lime px-[11px] py-[5px] text-[10px] font-bold uppercase tracking-[0.1em] text-lime-text">
      <span className="h-1.5 w-1.5 rounded-full bg-lime-text" />
      Early Alpha
    </span>
  );
}

interface BulletProps {
  readonly bold: string;
  readonly rest: string;
}

function Bullet({ bold, rest }: BulletProps) {
  return (
    <li className="flex items-start gap-3 text-[14px] leading-[1.45]">
      <span className="mt-[1px] flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full bg-green-dark text-[12px] font-bold text-text-inverted">
        →
      </span>
      <span className="text-text-secondary">
        <b className="font-semibold text-text-primary">{bold}</b> {rest}
      </span>
    </li>
  );
}

interface ErrorAlertProps {
  readonly tone: "info" | "warn";
  readonly message: string;
}

function ErrorAlert({ tone, message }: ErrorAlertProps) {
  const palette =
    tone === "info"
      ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E3A8A]"
      : "border-[#FDE68A] bg-[#FEFCE8] text-[#854D0E]";
  return (
    <div
      className={`mb-3 rounded-btn border px-3 py-2 text-[13px] leading-[1.4] ${palette}`}
      role="alert"
    >
      {message}
    </div>
  );
}

function BannedScreen() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5">
      <div className="w-full max-w-[320px] text-center">
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-text-primary">
          Account banned
        </h1>
        <p className="mt-3 text-[15px] leading-[1.5] text-text-secondary">
          Your PITCHUP account has been banned. If you think this is a mistake,
          you can appeal &mdash; describe the situation and we&rsquo;ll review.
        </p>
        <a
          href="mailto:appeals@pitchup.online?subject=Account%20appeal"
          className="mt-6 flex h-14 w-full items-center justify-center rounded-btn bg-green-dark text-[16px] font-semibold text-text-inverted shadow-btn transition-colors hover:bg-green-mid"
        >
          Appeal &mdash; email us
        </a>
      </div>
    </main>
  );
}
