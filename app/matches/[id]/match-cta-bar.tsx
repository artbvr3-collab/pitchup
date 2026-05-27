/**
 * MODULE: app.matches.id.match-cta-bar
 * PURPOSE: Renders the result of `computeCta()` as one or two buttons +
 *          optional info line. Hooks up the live actions:
 *            - Layer 5: `join`, `manage`, `signIn`
 *            - Layer 6: `leave`, `cancelRequest`, `notifyMe`, `stopWatching`
 *          The remaining coming-soon action (`like`, Layer 6.X) still
 *          renders disabled with a "Coming soon" title.
 * LAYER: interfaces (client)
 * DEPENDENCIES: src/ui/components/button, react, next/navigation
 * INVARIANTS:
 *   - Each live action funnels through a small helper that wraps fetch +
 *     error mapping + `router.refresh()` on success so the page re-fetches
 *     the canonical state from the server. Optimistic UI is intentionally
 *     NOT done — polling + RSC refresh is the truth source.
 *   - `notifyMe` 409 `not_full` is mapped to the spec toast text
 *     ("A spot just opened — refresh to join"). On success the user sees
 *     "We'll ping you next time a spot opens." which matches the spec wording.
 *   - `leave` and `cancelRequest` confirm before fire (mis-tap protection).
 *     Layer 6 ships a `confirm()` dialog; spec calls for richer modals
 *     (reason radio for Leave) — deferred to a UI polish pass.
 *   - 404 on `leave` / `cancelRequest` (race with cron / kick / approve) is
 *     treated as success-no-op per spec "Idempotency" — we just refresh.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "CTA bar", "Leave flow",
 *     "Cancel request flow", "Watching logic"
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CtaAction, CtaSpec } from "@/src/match_lifecycle/domain/compute-cta";
import { Button } from "@/src/ui/components/button";

export interface MatchCtaBarProps {
  readonly matchId: string;
  readonly cta: CtaSpec;
  readonly onManageClick: () => void;
}

export function MatchCtaBar(props: MatchCtaBarProps) {
  return (
    <div className="flex flex-col gap-2">
      <CtaButton
        matchId={props.matchId}
        action={props.cta.primary}
        onManageClick={props.onManageClick}
      />
      {props.cta.secondary && (
        <CtaButton
          matchId={props.matchId}
          action={props.cta.secondary}
          onManageClick={props.onManageClick}
        />
      )}
      {props.cta.note && (
        <p className="text-center text-xs text-text-muted">{props.cta.note}</p>
      )}
    </div>
  );
}

function CtaButton(props: {
  matchId: string;
  action: CtaAction;
  onManageClick: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const { action, matchId } = props;

  // Sign-in → render as link.
  if (action.type === "signIn") {
    return (
      <Button asChild>
        <Link href={`/login?callbackUrl=/matches/${matchId}`}>
          {action.label}
        </Link>
      </Button>
    );
  }

  // Coming-soon buttons render disabled with a tooltip (Layer 6.X: `like`).
  if (action.comingSoon) {
    return (
      <Button variant={mapVariant(action)} disabled title="Coming soon">
        {action.label}
      </Button>
    );
  }

  // Naturally disabled (e.g. "You're in ✓", "Waiting for organizer…").
  if (action.disabled) {
    return (
      <Button variant={mapVariant(action)} disabled>
        {action.label}
      </Button>
    );
  }

  // ---------------- Live actions ----------------

  if (action.type === "manage") {
    return (
      <Button variant="primary" onClick={props.onManageClick}>
        {action.label}
      </Button>
    );
  }

  if (action.type === "join") {
    return (
      <Button
        variant="lime"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetch(`/api/matches/${matchId}/join`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ guest_count: 0 }),
            });
            await handleResponse(res, router, {
              successToast: null,
              codeMessages: {
                already_requested: "You already applied",
                already_in_match: "You're already on this match",
                captain_cannot_join: "Captain can't join their own match",
              },
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Joining…" : action.label}
      </Button>
    );
  }

  if (action.type === "leave") {
    return (
      <Button
        variant="destructive-ghost"
        disabled={busy}
        onClick={async () => {
          // Spec calls for a Leave modal with reason radio (Can't make it /
          // Injury / Personal / Other). Layer 6 ships a native confirm —
          // reason capture lands in a later UI polish pass.
          if (
            !window.confirm(
              "Leave this match? Your spot will be freed for someone else.",
            )
          ) {
            return;
          }
          setBusy(true);
          try {
            const res = await fetch(`/api/matches/${matchId}/leave`, {
              method: "POST",
            });
            await handleResponse(res, router, {
              successToast: null,
              treat404AsOk: true,
              codeMessages: {
                match_locked: "Match has already started",
              },
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Leaving…" : action.label}
      </Button>
    );
  }

  if (action.type === "cancelRequest") {
    return (
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          if (!window.confirm("Cancel your request to join?")) return;
          setBusy(true);
          try {
            const res = await fetch(
              `/api/matches/${matchId}/cancel-request`,
              { method: "POST" },
            );
            await handleResponse(res, router, {
              successToast: null,
              treat404AsOk: true,
              codeMessages: {
                already_accepted: "You were just accepted!",
                already_processed: "Request already processed",
              },
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Cancelling…" : action.label}
      </Button>
    );
  }

  if (action.type === "notifyMe") {
    return (
      <Button
        variant="lime"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetch(`/api/matches/${matchId}/watch`, {
              method: "POST",
            });
            await handleResponse(res, router, {
              successToast: "We'll ping you next time a spot opens.",
              codeMessages: {
                not_full: "A spot just opened — refresh to join",
                captain_cannot_watch: "Captain can't watch their own match",
                already_in_match: "You're already on this match",
              },
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Subscribing…" : action.label}
      </Button>
    );
  }

  if (action.type === "stopWatching") {
    return (
      <Button
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await fetch(`/api/matches/${matchId}/watch`, {
              method: "DELETE",
            });
            await handleResponse(res, router, {
              successToast: null,
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Stopping…" : action.label}
      </Button>
    );
  }

  // Fallback (`none` / `like` after comingSoon flip).
  return (
    <Button variant="disabled" disabled>
      {action.label}
    </Button>
  );
}

function mapVariant(
  action: CtaAction,
): "primary" | "lime" | "ghost" | "destructive-ghost" | "disabled" {
  switch (action.variant) {
    case "primary":
      return action.type === "join" || action.type === "notifyMe"
        ? "lime"
        : "primary";
    case "ghost":
      return "ghost";
    case "destructive":
      return "destructive-ghost";
    case "info":
    default:
      return "disabled";
  }
}

/**
 * Shared response handler: on 2xx, run `router.refresh()` so the RSC
 * re-fetches; on 4xx, show a code-specific alert (toast system not yet in
 * place — Layer 5 punted on it). Optional `treat404AsOk` covers the spec's
 * idempotency: re-cancel / re-leave on an already-terminal JR should not
 * error in the UI.
 */
async function handleResponse(
  res: Response,
  router: ReturnType<typeof useRouter>,
  opts: {
    successToast: string | null;
    treat404AsOk?: boolean;
    codeMessages?: Record<string, string>;
  },
): Promise<void> {
  if (res.ok) {
    if (opts.successToast) window.alert(opts.successToast);
    router.refresh();
    return;
  }
  if (opts.treat404AsOk && res.status === 404) {
    router.refresh();
    return;
  }
  const body = (await res.json().catch(() => null)) as
    | { code?: string }
    | null;
  const code = body?.code ?? `http_${res.status}`;
  const text = opts.codeMessages?.[code] ?? `Error: ${code}`;
  window.alert(text);
  // Refresh so the CTA reflects current server-side state even after a
  // benign error like `already_processed`.
  router.refresh();
}
