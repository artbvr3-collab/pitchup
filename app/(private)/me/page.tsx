/**
 * MODULE: app.(private).me.page
 * PURPOSE: Layer-6 /me Server Component. Renders profile header + four
 *          settings sections (ACCOUNT / NOTIFICATIONS / LEGAL / ACCOUNT
 *          ACTIONS). The two interactive bits — Edit profile and Email
 *          notifications toggle — live in client islands wired to the
 *          `updateProfileAction` Server Action.
 *
 *          Layer 7b: the Browser notifications toggle is live (client island
 *          `BrowserNotificationsToggle`, hidden on iOS). Still deferred:
 *            - View public profile → /users/:id (Layer 7.5)
 *            - Delete account (Layer 7.5 — sensitive cascade)
 *            - In-app inbox has no toggle by spec (always on)
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (requireAuth + userRepository for fresh
 *               profile fields), ./actions (signOutAction)
 * INVARIANTS:
 *   - Auth-only. `requireAuth` throws on guest/banned/deleted; middleware
 *     already redirects guests to /login?callbackUrl=/me.
 *   - Reads `contactInfo` + `emailNotifications` via the userRepository
 *     (not from session) — session carries name/email/isAdmin only.
 *   - Sign out is rendered as a form posting to a Server Action (the only
 *     real "destructive" action on Layer 6's /me; Delete is deferred).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/me"
 *   - docs/ROADMAP.md → Layer 6
 */
import Link from "next/link";

import {
  requireAuth,
  userRepository,
} from "@/src/auth/composition";
import { asUserId } from "@/src/auth/domain/user";
import { cn } from "@/src/ui/lib/cn";

import { signOutAction } from "./actions";
import { BrowserNotificationsToggle } from "./browser-notifications-toggle";
import { EditProfileSection } from "./edit-profile-section";
import { EmailNotificationsToggle } from "./email-notifications-toggle";

export const dynamic = "force-dynamic";

export default async function MePage() {
  const session = await requireAuth();
  // Fetch fresh row — session lacks contactInfo + emailNotifications.
  // findByIds is the existing batch lookup; passing a single id is fine.
  const [user] = await userRepository.findByIds([asUserId(session.userId)]);
  if (!user) {
    // Defensive: requireAuth already verifies the row, so this is a race
    // (deletion between auth check and read). Treat like a session loss.
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-[375px] flex-col items-center justify-center px-6 text-center">
        <p className="text-[14px] text-text-secondary">
          Your account is no longer available.
        </p>
        <form action={signOutAction} className="mt-4">
          <button
            type="submit"
            className="text-[14px] font-semibold text-green-dark"
          >
            Sign out
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[375px] px-4 pb-12 pt-4">
      <h1 className="mb-4 text-[22px] font-bold leading-tight tracking-tight text-text-primary">
        Profile
      </h1>

      <Header avatarUrl={user.avatarUrl} name={user.name} email={user.email} />

      <SectionHeader title="Account" />
      <div className="mb-6 space-y-3">
        <EditProfileSection
          initialName={user.name}
          initialContactInfo={user.contactInfo}
        />
        <DisabledRow
          icon="👤"
          label="View public profile"
          comingSoon="Coming in Layer 7"
        />
      </div>

      <SectionHeader title="Notifications" />
      <div className="mb-6 space-y-3">
        <SettingRow
          icon="✉️"
          label="Email notifications"
          description="We'll email you when you get accepted, removed, or on match day."
          control={
            <EmailNotificationsToggle initialEnabled={user.emailNotifications} />
          }
        />
        <BrowserNotificationsToggle />
      </div>

      <SectionHeader title="Legal" />
      <div className="mb-6 space-y-3">
        <LegalRow icon="📄" label="Terms of service" href="/legal/terms" />
        <LegalRow icon="🔒" label="Privacy policy" href="/legal/privacy" />
      </div>

      <SectionHeader title="Account" />
      <div className="space-y-3">
        <form action={signOutAction}>
          <button
            type="submit"
            className="flex w-full items-center justify-between rounded-card bg-bg-card p-4 shadow-card transition-colors hover:bg-bg-card-dim"
          >
            <span className="flex items-center gap-3">
              <span className="text-[18px]" aria-hidden>
                ↩
              </span>
              <span className="text-[15px] font-semibold text-text-primary">
                Sign out
              </span>
            </span>
            <span className="text-text-secondary">›</span>
          </button>
        </form>
        <DisabledRow
          icon="🗑️"
          label="Delete account"
          comingSoon="Coming in Layer 7"
          destructive
        />
      </div>
    </main>
  );
}

function Header({
  avatarUrl,
  name,
  email,
}: {
  avatarUrl: string;
  name: string;
  email: string;
}) {
  return (
    <div className="mb-6 flex flex-col items-center text-center">
      {avatarUrl ? (
        // Avatar from Google, not user-uploaded. Direct <img> is fine for
        // a remote CDN URL (consistent with /welcome avatar handling).
        // eslint-disable-next-line @next/next/no-img-element -- Google CDN URL
        <img
          src={avatarUrl}
          alt=""
          width={88}
          height={88}
          className="h-[88px] w-[88px] rounded-full border border-border bg-bg-card object-cover"
        />
      ) : (
        <div className="flex h-[88px] w-[88px] items-center justify-center rounded-full border border-border bg-bg-card text-[28px] font-bold text-text-muted">
          {name.charAt(0).toUpperCase() || "?"}
        </div>
      )}
      <div className="mt-3 text-[18px] font-bold text-text-primary">
        {name}
      </div>
      <div className="mt-1 text-[12px] text-text-secondary">{email}</div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
      {title}
    </h2>
  );
}

function SettingRow({
  icon,
  label,
  description,
  control,
}: {
  icon: string;
  label: string;
  description?: string;
  control: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-card bg-bg-card p-4 shadow-card">
      <span className="text-[18px] leading-none" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-text-primary">
          {label}
        </div>
        {description && (
          <div className="mt-0.5 text-[12px] text-text-secondary">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function DisabledRow({
  icon,
  label,
  description,
  comingSoon,
  destructive = false,
}: {
  icon: string;
  label: string;
  description?: string;
  comingSoon: string;
  destructive?: boolean;
}) {
  return (
    <div
      title={comingSoon}
      className="flex items-start gap-3 rounded-card bg-bg-card p-4 opacity-60 shadow-card"
    >
      <span className="text-[18px] leading-none" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "text-[15px] font-semibold",
            destructive ? "text-status-full" : "text-text-primary",
          )}
        >
          {label}
        </div>
        {description && (
          <div className="mt-0.5 text-[12px] text-text-secondary">
            {description}
          </div>
        )}
        <div className="mt-1 text-[11px] italic text-text-muted">
          {comingSoon}
        </div>
      </div>
    </div>
  );
}

function LegalRow({
  icon,
  label,
  href,
}: {
  icon: string;
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-card bg-bg-card p-4 shadow-card transition-colors hover:bg-bg-card-dim"
    >
      <span className="flex items-center gap-3">
        <span className="text-[18px]" aria-hidden>
          {icon}
        </span>
        <span className="text-[15px] font-semibold text-text-primary">
          {label}
        </span>
      </span>
      <span className="text-text-secondary">›</span>
    </Link>
  );
}
