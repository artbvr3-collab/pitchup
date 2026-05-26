/**
 * MODULE: app.matches.id.match-cta-bar
 * PURPOSE: Renders the result of `computeCta()` as one or two buttons +
 *          optional info line. Hooks up the in-scope actions for Layer 5:
 *          `join` → POST /api/matches/:id/join (Layer 4 endpoint),
 *          `manage` → opens captain sheet, `signIn` → /login link.
 *          Out-of-scope actions (`leave` / `cancelRequest` / `watch` /
 *          `stopWatching` / `like`) render disabled with a "Coming soon"
 *          title; their endpoints land in Layer 6+.
 * LAYER: interfaces (client)
 * DEPENDENCIES: src/ui/components/button, react,
 *               next/navigation (router.refresh on Join success)
 * INVARIANTS:
 *   - Disabled-by-cascade is rendered with `variant=disabled` (greyed); a
 *     coming-soon action uses the same `disabled` HTML attribute but adds
 *     the title tooltip so the user understands it's not the final state.
 *   - Join calls the Layer 4 endpoint with `guest_count: 0` and no
 *     message. The full Join modal (stepper + textarea) is deferred to a
 *     UI follow-up; one-tap join works for MVP testing.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "CTA bar"
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

  // Coming-soon buttons render disabled with a tooltip.
  if (action.comingSoon) {
    return (
      <Button
        variant={mapVariant(action)}
        disabled
        title="Coming soon"
      >
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

  // Live actions.
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
            if (!res.ok) {
              // Layer 5 toast system not yet built — surface inline.
              const body = (await res.json().catch(() => null)) as
                | { code?: string }
                | null;
              alert(`Join failed: ${body?.code ?? res.status}`);
              return;
            }
            router.refresh();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Joining…" : action.label}
      </Button>
    );
  }

  if (action.type === "manage") {
    return (
      <Button variant="primary" onClick={props.onManageClick}>
        {action.label}
      </Button>
    );
  }

  // Fallback (`none` / `info`) — render as plain disabled label.
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
