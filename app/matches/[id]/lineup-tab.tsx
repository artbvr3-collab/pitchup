/**
 * MODULE: app.matches.id.lineup-tab
 * PURPOSE: Lineup tab — accepted players (captain + real + crew stubs) +
 *          pending list. Captain sees inline `[✓]` `[✗]` buttons on
 *          pending entries (calls Layer 4 endpoints /approve, /reject).
 *          Layer 6+: shuffle teams (deferred).
 * LAYER: interfaces (client)
 * INVARIANTS:
 *   - Crew stubs render with 50% opacity + silhouette avatar + tooltip
 *     "Not on app yet". Spec §178.
 *   - Approve `[✓]` disabled when `1 + guest_count > free` per spec §179.
 *   - Reject confirmation modal omitted in this layer; UX follow-up.
 *     Approve fires immediately (spec §186).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Tab Lineup", "Approve flow"
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import type {
  MatchStateLineupPending,
  MatchStateMessageAuthor,
  MatchStateResponse,
} from "@/src/match_lifecycle/application/dto/match-state";
import type { ViewerRole } from "@/src/match_lifecycle/domain/compute-cta";
import { Card } from "@/src/ui/components/card";
import { cn } from "@/src/ui/lib/cn";

export interface LineupTabProps {
  readonly state: MatchStateResponse;
  readonly totalSpots: number;
  readonly crew: readonly string[];
  readonly viewerRole: ViewerRole;
  readonly matchId: string;
}

export function LineupTab(props: LineupTabProps) {
  const acceptedSlots = props.state.lineup.accepted.reduce(
    (n, p) => n + 1 + p.guest_count,
    0,
  );
  const filled = 1 + props.crew.length + acceptedSlots;
  const free = Math.max(0, props.totalSpots - filled);

  return (
    <div className="flex flex-col gap-4">
      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-text-secondary">
          Accepted ({filled} / {props.totalSpots})
        </h2>
        <div className="flex flex-col gap-2">
          <PlayerRow user={props.state.lineup.captain} badge="Cap" />
          {props.state.lineup.accepted.map((player) => (
            <PlayerRow
              key={player.user.id}
              user={player.user}
              guestCount={player.guest_count}
            />
          ))}
          {props.crew.map((name) => (
            <StubRow key={`crew-${name}`} name={name} />
          ))}
        </div>
      </section>

      {props.state.lineup.pending.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-text-secondary">
            Pending ({props.state.lineup.pending.length})
          </h2>
          <div className="flex flex-col gap-2">
            {props.state.lineup.pending.map((p) => (
              <PendingRow
                key={p.request_id}
                pending={p}
                free={free}
                isCaptain={props.viewerRole === "captain"}
                matchId={props.matchId}
              />
            ))}
          </div>
        </section>
      )}

      {props.viewerRole === "captain" && props.state.lineup.watching_count > 0 && (
        <p className="text-center text-xs text-text-muted">
          {props.state.lineup.watching_count} watching this match
        </p>
      )}
    </div>
  );
}

function PlayerRow({
  user,
  badge,
  guestCount,
}: {
  user: MatchStateMessageAuthor;
  badge?: string;
  guestCount?: number;
}) {
  const isRemoved = user.banned;
  return (
    <Card variant="compact">
      <div className="flex items-center gap-2">
        <Avatar
          initials={isRemoved ? "?" : initialsOf(user.name)}
          dimmed={isRemoved}
        />
        <div className="flex-1">
          <p className="text-sm font-medium">
            {isRemoved ? "[Removed user]" : shortName(user.name)}
            {guestCount && guestCount > 0 ? (
              <span className="ml-2 rounded-badge bg-lime/40 px-1.5 py-0.5 text-xs font-bold text-lime-text">
                +{guestCount}
              </span>
            ) : null}
          </p>
        </div>
        {badge ? (
          <span className="rounded-badge bg-lime px-1.5 py-0.5 text-[10px] font-bold text-lime-text">
            {badge}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

function StubRow({ name }: { name: string }) {
  return (
    <Card variant="compact" className="opacity-50">
      <div className="flex items-center gap-2" title="Not on app yet">
        <Avatar initials={initialsOf(name)} dimmed />
        <p className="flex-1 text-sm font-medium text-text-secondary">{name}</p>
      </div>
    </Card>
  );
}

function PendingRow({
  pending,
  free,
  isCaptain,
  matchId,
}: {
  pending: MatchStateLineupPending;
  free: number;
  isCaptain: boolean;
  matchId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const slotsNeeded = 1 + pending.guest_count;
  const approveDisabled = slotsNeeded > free;

  const act = async (action: "approve" | "reject") => {
    setBusy(action);
    try {
      const res = await fetch(`/api/matches/${matchId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: pending.request_id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { code?: string }
          | null;
        alert(`${action} failed: ${body?.code ?? res.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card variant="compact" className="opacity-70">
      <div className="flex items-center gap-2">
        <Avatar initials={initialsOf(pending.user.name)} dimmed />
        <div className="flex-1">
          <p className="text-sm font-medium">
            {shortName(pending.user.name)}
            {pending.guest_count > 0 ? (
              <span className="ml-2 rounded-badge bg-lime/40 px-1.5 py-0.5 text-xs font-bold text-lime-text">
                +{pending.guest_count}
              </span>
            ) : null}
          </p>
          {pending.message ? (
            <p className="text-xs text-text-muted line-clamp-2">
              {pending.message}
            </p>
          ) : null}
        </div>
        {isCaptain && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => act("approve")}
              disabled={approveDisabled || busy !== null}
              title={
                approveDisabled
                  ? "Not enough spots — increase Total or reject"
                  : "Approve"
              }
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold",
                approveDisabled
                  ? "bg-bg-surface text-text-muted"
                  : "bg-green-dark text-text-inverted",
              )}
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => act("reject")}
              disabled={busy !== null}
              title="Reject"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive-bg text-sm font-bold text-destructive"
            >
              ✗
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

function Avatar({
  initials,
  dimmed = false,
}: {
  initials: string;
  dimmed?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-text-inverted",
        dimmed ? "bg-text-muted" : "bg-green-dark",
      )}
    >
      {initials}
    </div>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return name;
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[1]![0]!}.`;
}
