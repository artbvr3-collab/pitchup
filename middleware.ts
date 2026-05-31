/**
 * MODULE: middleware (root)
 * PURPOSE: Authentication + onboarding gate. Runs on every protected request,
 *          performs one SELECT on `users.google_sub` to decide:
 *            - guest → `/login?callbackUrl=…` (or pass for public pages)
 *            - signed-in without DB row → `/welcome?callbackUrl=…`
 *              (or pass if path is in the onboarding allowlist)
 *            - signed-in + banned → `/login?error=banned`
 *            - signed-in + soft-deleted → `/login`
 *            - signed-in + onboarded on `/welcome` → `/my-matches`
 *          The path lists are Layer-1 minimal: `/games`, `/map`, `/me`,
 *          `/chats`, `/admin/*` etc. will be added as their layers land.
 * LAYER: interfaces (cross-cutting auth gate)
 * RUNTIME: nodejs — Prisma is not Edge-compatible without a driver adapter,
 *          and the spec mandates an actual DB SELECT here.
 * RELATED DOCS: docs/spec/pitchup-spec-global.md "Onboarding guard",
 *               "Session invalidation".
 */
import { NextResponse } from "next/server";

import { asGoogleSub } from "@/src/auth/domain/user";
import { auth } from "@/src/auth/infrastructure/auth";
import { userRepository } from "@/src/auth/infrastructure/repositories";

export const runtime = "nodejs";

// Pages a guest may open without a session AND a signed-in user may revisit.
// `/games` is the public Discover feed — accessible to guests per spec
// (docs/spec/pitchup-spec-discovery.md → "/games").
// `/users/:id` is the public player profile (Layer 7.5) — accessible to
// guests too (spec personal.md "/users/:id"). It also serves a unified
// "no longer on PITCHUP" page for banned / deleted / 404 — that's a
// public render, not a redirect.
// `/matches/:id` is also guest-public but lives in its own dynamic check
// below (`isPublicMatchView`) so the sibling auth-gated routes
// `/matches/new` and `/matches/:id/edit` aren't accidentally opened up.
const PUBLIC_PATHS: readonly string[] = ["/", "/login", "/games", "/map"];
const PUBLIC_PREFIXES: readonly string[] = ["/legal/", "/users/"];

// Paths a signed-in user *without* a DB row may access without being bounced
// to `/welcome` (spec: "Onboarding guard" → allowlist).
const ONBOARDING_ALLOWED_PATHS: readonly string[] = ["/welcome"];
const ONBOARDING_ALLOWED_PREFIXES: readonly string[] = ["/legal/"];

function startsWithAny(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => pathname.startsWith(p));
}

// `/matches/:id` is a public match-detail page — guests render it with a
// disabled `[Sign in to join]` CTA and read-only chat (spec global.md
// "Guest" + app-map.md "Guest can View /matches/:id"; Share is a public
// link). But ONLY the bare detail route: the create wizard `/matches/new`
// and the captain-only `/matches/:id/edit` stay auth-gated. So we whitelist
// exactly one path segment after `/matches/`, excluding `new`.
function isPublicMatchView(pathname: string): boolean {
  if (!pathname.startsWith("/matches/")) return false;
  const rest = pathname.slice("/matches/".length);
  return rest.length > 0 && !rest.includes("/") && rest !== "new";
}

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    startsWithAny(pathname, PUBLIC_PREFIXES) ||
    isPublicMatchView(pathname)
  );
}

function isOnboardingAllowed(pathname: string): boolean {
  return (
    ONBOARDING_ALLOWED_PATHS.includes(pathname) ||
    startsWithAny(pathname, ONBOARDING_ALLOWED_PREFIXES)
  );
}

function redirectTo(req: { nextUrl: URL }, path: string, callbackUrl?: string): NextResponse {
  const target = new URL(path, req.nextUrl);
  if (callbackUrl !== undefined) {
    target.searchParams.set("callbackUrl", callbackUrl);
  }
  return NextResponse.redirect(target);
}

export default auth(async (req) => {
  const { pathname, search } = req.nextUrl;
  const session = req.auth;
  const currentUrlForCallback = pathname + search;

  // No session — guest.
  if (!session?.googleSub) {
    if (pathname === "/welcome") {
      // Spec rule 1: guest on /welcome → /login (no callbackUrl).
      return redirectTo(req, "/login");
    }
    if (isPublic(pathname)) {
      return NextResponse.next();
    }
    return redirectTo(req, "/login", currentUrlForCallback);
  }

  // Signed in — DB lookup (spec: "Session invalidation" + "Onboarding guard").
  const user = await userRepository.findByGoogleSub(asGoogleSub(session.googleSub));

  if (user?.banned) {
    return redirectTo(req, "/login?error=banned");
  }
  if (user?.deletedAt) {
    return redirectTo(req, "/login");
  }

  // Signed in but no row yet — onboarding pending.
  if (!user) {
    if (isOnboardingAllowed(pathname)) {
      return NextResponse.next();
    }
    // Spec rule 2: signed-in + no row + path not in allowlist → /welcome with callbackUrl.
    return redirectTo(req, "/welcome", currentUrlForCallback);
  }

  // Spec rule 3: signed-in + onboarded + on /welcome → /my-matches.
  if (pathname === "/welcome") {
    return redirectTo(req, "/my-matches");
  }

  // Spec rule 4 (Layer 9): the `/admin` area is admin-only.
  // - non-admin → silent redirect to /my-matches. NO 403 page — we do not
  //   expose the panel's existence to regular users (spec personal.md →
  //   "/admin" → Access).
  // - admin landing on bare `/admin` → canonical first tab /admin/users.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!user.isAdmin) {
      return redirectTo(req, "/my-matches");
    }
    if (pathname === "/admin") {
      return redirectTo(req, "/admin/users");
    }
  }

  return NextResponse.next();
});

// Run on every route EXCEPT `/api/*` (handlers do their own `requireAuth()`),
// Next internals, and any path that looks like a static file (contains a dot).
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
