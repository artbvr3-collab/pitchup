/**
 * MODULE: app.users.id.page
 * PURPOSE: Server Component for `/users/:id` — the public player profile
 *          (spec personal.md "/users/:id"). Accessible to everyone (signed
 *          in or guest). Renders avatar + name + contact info, OR the
 *          unified "This user is no longer on PITCHUP." state for
 *          banned / deleted / 404 (privacy — outside observers don't see
 *          which it is).
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (optionalAuth, userRepository),
 *               src/auth/domain/user
 * INVARIANTS:
 *   - Auth-OPTIONAL: guests render the same page; only "Report player"
 *     (Layer 9 — moderation) needs a session, and we don't render that
 *     menu in Layer 7.5 at all.
 *   - **Self-redirect.** If the viewer is signed in AND `id === viewer.userId`
 *     → `redirect('/me')` per spec personal.md §190. This happens BEFORE
 *     the user lookup so an own deleted-profile view (impossible state —
 *     deleted users can't reach this page — but defensive) doesn't 404.
 *   - **Unified privacy sentinel.** `banned || deletedAt !== null` AND
 *     "row not found" all render the SAME copy. Spec global.md "Ban /
 *     account deletion" mandates outside observers cannot tell ban from
 *     self-delete from never-existed. The HTTP status stays 200 — Next's
 *     `notFound()` would emit 404 (which would also be observable; we
 *     deliberately keep this 200 with a sentinel body).
 *   - **OG meta:** real name + standard description for active users;
 *     landing-page defaults for the sentinel states (so a link previewed
 *     in a chat looks identical to /). The `og:image` is the static
 *     landing image; we do NOT host Google avatar URLs.
 *   - **Report player menu (Layer 9):** the `[⋯]` menu is intentionally
 *     not rendered here. When moderation lands, add it as a client island
 *     gated on `optionalAuth() !== null` (guest still sees the menu per
 *     spec — tap → Sign-in modal). For Layer 7.5 we ship a clean
 *     read-only profile.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/users/:id"
 *   - docs/spec/pitchup-spec-global.md → "Ban / account deletion"
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

import { optionalAuth, userRepository } from "@/src/auth/composition";
import { asUserId } from "@/src/auth/domain/user";

import { UserHeaderMenu } from "./user-header-menu";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ id: string }>;
}

const REMOVED_TITLE = "PITCHUP";
const REMOVED_DESCRIPTION = "Pickup football in Prague.";

export async function generateMetadata(
  props: PageProps,
): Promise<Metadata> {
  const { id } = await props.params;
  const user = await safeFindUser(id);
  if (!user || user.banned || user.deletedAt !== null) {
    return {
      title: REMOVED_TITLE,
      description: REMOVED_DESCRIPTION,
      openGraph: {
        title: REMOVED_TITLE,
        description: REMOVED_DESCRIPTION,
        url: `/users/${id}`,
        images: ["/og/landing.png"],
      },
      twitter: { card: "summary" },
    };
  }
  const title = `${user.name} · PITCHUP`;
  const description = `Check out ${user.name}'s profile on PITCHUP.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description: REMOVED_DESCRIPTION,
      url: `/users/${user.id}`,
      images: ["/og/landing.png"],
    },
    twitter: { card: "summary" },
  };
}

export default async function UserProfilePage(props: PageProps) {
  const { id } = await props.params;

  const viewer = await optionalAuth();
  if (viewer && viewer.userId === id) {
    redirect("/me");
  }

  const user = await safeFindUser(id);
  if (!user || user.banned || user.deletedAt !== null) {
    return <RemovedUser />;
  }

  return (
    <main className="mx-auto w-full max-w-[375px] px-4 pb-12 pt-4">
      <div className="flex h-9 items-center justify-between">
        <BackBar />
        {/* Guests see the menu too — tap → Sign-in (spec personal.md §305). */}
        <UserHeaderMenu userId={id} signedIn={viewer !== null} />
      </div>

      <div className="mt-4 flex flex-col items-center text-center">
        {user.avatarUrl ? (
          // Avatar from Google; direct <img> mirrors /me (Google CDN).
          // eslint-disable-next-line @next/next/no-img-element -- Google CDN URL
          <img
            src={user.avatarUrl}
            alt=""
            width={96}
            height={96}
            className="h-[96px] w-[96px] rounded-full border border-border bg-bg-card object-cover"
          />
        ) : (
          <div className="flex h-[96px] w-[96px] items-center justify-center rounded-full border border-border bg-bg-card text-[32px] font-bold text-text-muted">
            {user.name.charAt(0).toUpperCase() || "?"}
          </div>
        )}
        <h1 className="mt-3 text-[22px] font-bold leading-tight tracking-tight text-text-primary">
          {user.name}
        </h1>
      </div>

      {user.contactInfo && (
        <section className="mt-6 rounded-card bg-bg-card p-4 shadow-card">
          <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
            Contact info
          </h2>
          {/* Plain text per spec; the browser/UA auto-linkifies http(s):// + emails. */}
          <p className="whitespace-pre-wrap break-words text-[14px] text-text-primary">
            {user.contactInfo}
          </p>
        </section>
      )}
    </main>
  );
}

/** Wraps the repository call so an invalid (non-UUID) id reads as 404. */
async function safeFindUser(id: string) {
  try {
    return await userRepository.findById(asUserId(id));
  } catch {
    return null;
  }
}

function BackBar() {
  // Hand-rolled mini TopBar (no shared TopBar component yet for guest pages).
  // `Link href="/games"` is a safe fallback — `router.back()` is not available
  // server-side, so deep links land on Discover. For signed-in viewers the
  // BackButton in mobile browsers still works as expected.
  return (
    <div className="flex h-9 items-center">
      <Link
        href="/games"
        className="-ml-1 inline-flex items-center gap-1 rounded-card px-2 py-1 text-[14px] font-medium text-text-secondary hover:text-text-primary"
        aria-label="Back"
      >
        <span aria-hidden>←</span>
        <span>Back</span>
      </Link>
    </div>
  );
}

function RemovedUser() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[375px] flex-col items-center justify-center px-6 text-center">
      <p className="text-[15px] text-text-secondary">
        This user is no longer on PITCHUP.
      </p>
      <Link
        href="/games"
        className="mt-4 inline-flex h-11 items-center justify-center rounded-card bg-bg-card px-6 text-[14px] font-semibold text-text-primary hover:bg-bg-card-dim"
      >
        Back
      </Link>
    </main>
  );
}
