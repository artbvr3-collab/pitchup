/**
 * MODULE: app.matches.id.match-shell
 * PURPOSE: Client island that owns the page's interactive state — active
 *          tab, captain sheet open/close, and the polling state slice
 *          shared between Lineup and Chat. The RSC page passes everything
 *          it needs as serialisable props (no Match/Venue domain types
 *          here — strings and primitives only).
 * LAYER: interfaces (client)
 * DEPENDENCIES: ./match-hero, ./match-cta-bar, ./match-tabs,
 *               ./lineup-tab, ./chat-tab, ./captain-sheet,
 *               src/match_lifecycle/domain/compute-cta, ./use-match-state,
 *               src/ui/hooks/use-polling
 * INVARIANTS:
 *   - `?tab=` and `?sheet=` are removed from the URL via `router.replace`
 *     after they've been read on mount, so F5 / back don't reopen the
 *     sheet / re-trigger the tab (spec §58 and §266).
 *   - Polling is enabled only when the viewer is captain or accepted.
 *     Pending / watching / guest poll-enabled=false (spec §215-216);
 *     they still see the static initial snapshot.
 *   - The polling payload is merged INTO `state` here; both Lineup and
 *     Chat read the same merged slice.
 *   - Cancelled / Ended / InProgress matches do not poll at all — there's
 *     nothing live to update; the static snapshot is the final state.
 *   - Status string in `initialState` is the wire form (`Open`,
 *     `AlmostFull`, etc.) — converted to the domain enum for `computeCta`
 *     once at the top of render.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "/matches/:id"
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { computeCta } from "@/src/match_lifecycle/domain/compute-cta";
import type { ViewerRole } from "@/src/match_lifecycle/domain/compute-cta";
import type { MatchStatus } from "@/src/match_lifecycle/domain/match-status";
import type {
  MatchStateMessage,
  MatchStateResponse,
} from "@/src/match_lifecycle/application/dto/match-state";
import { usePolling, PollingHttpError } from "@/src/ui/hooks/use-polling";

import { CaptainSheet } from "./captain-sheet";
import { ChatTab } from "./chat-tab";
import { LineupTab } from "./lineup-tab";
import { MatchCtaBar } from "./match-cta-bar";
import { MatchHero } from "./match-hero";
import { MatchTabs, type TabId } from "./match-tabs";

export interface MatchShellProps {
  readonly matchId: string;
  readonly venue: {
    readonly name: string;
    readonly address: string;
    readonly googleMapsUrl: string | null;
  };
  readonly match: {
    readonly id: string;
    readonly startTime: string; // ISO
    readonly duration: number;
    readonly totalSpots: number;
    readonly price: number;
    readonly surface: "grass" | "hard";
    readonly studsAllowed: boolean;
    readonly fieldBooked: boolean;
    readonly description: string | null;
    readonly cancelReason: string | null;
    readonly captainCrew: readonly string[];
  };
  readonly viewerRole: ViewerRole;
  readonly viewerId: string | null;
  readonly initialState: MatchStateResponse;
  readonly initialTab: TabId;
  readonly autoOpenCaptainSheet: boolean;
}

export function MatchShell(props: MatchShellProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [state, setState] = useState<MatchStateResponse>(props.initialState);
  const [activeTab, setActiveTab] = useState<TabId>(props.initialTab);
  const [captainSheetOpen, setCaptainSheetOpen] = useState(
    props.autoOpenCaptainSheet,
  );

  // Strip ?tab= and ?sheet= from the URL once we've read them — same
  // convention as the Discover bottom-sheet (router.replace, no history
  // pollution).
  useEffect(() => {
    if (!searchParams.get("tab") && !searchParams.get("sheet")) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tab");
    params.delete("sheet");
    const qs = params.toString();
    router.replace(qs.length > 0 ? `?${qs}` : window.location.pathname, {
      scroll: false,
    });
  }, [router, searchParams]);

  // Status branch decides whether polling runs at all (Cancelled / Ended /
  // InProgress have no live updates; spec match.md "Polling for match
  // state" mentions captain+accepted only — pending/watching/guest pause).
  const isLiveStatus =
    state.status === "Open" ||
    state.status === "AlmostFull" ||
    state.status === "Full";
  const canPoll =
    isLiveStatus &&
    (props.viewerRole === "captain" || props.viewerRole === "accepted");

  // Cursor for the polling delta — last message timestamp we've seen.
  const sinceCursor = useMemo(() => {
    if (state.messages.length === 0) return null;
    let max = state.messages[0]!.created_at;
    for (const m of state.messages) {
      if (m.created_at > max) max = m.created_at;
      if (m.deleted_at !== null && m.deleted_at > max) max = m.deleted_at;
    }
    return max;
  }, [state.messages]);

  const pollUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (sinceCursor) params.set("since", sinceCursor);
    const qs = params.toString();
    return `/api/matches/${props.matchId}/state${qs ? `?${qs}` : ""}`;
  }, [props.matchId, sinceCursor]);

  usePolling<MatchStateResponse>({
    url: pollUrl,
    enabled: canPoll,
    onPayload: (payload) => {
      setState((prev) => mergePollPayload(prev, payload));
      if (payload.deleted) {
        router.push("/games");
      }
    },
    onError: (err) => {
      // 401 → ban / session-loss → /games (spec global.md "Session
      // invalidation"). Network and other HTTP errors fall through to the
      // hook's exponential back-off.
      if (err instanceof PollingHttpError && err.status === 401) {
        router.push("/games");
      }
    },
  });

  const domainStatus = wireToDomainStatus(state.status);
  const isFull = state.lineup.accepted.length + state.lineup.crew.length + 1 >=
    props.match.totalSpots;
  const cta = computeCta({
    matchStatus: domainStatus,
    viewerRole: props.viewerRole,
    isFull,
  });

  return (
    <main className="mx-auto flex max-w-[375px] flex-col gap-4 pb-12">
      <MatchHero
        venueName={props.venue.name}
        venueAddress={props.venue.address}
        googleMapsUrl={props.venue.googleMapsUrl}
        startTime={props.match.startTime}
        duration={props.match.duration}
        price={props.match.price}
        surface={props.match.surface}
        studsAllowed={props.match.studsAllowed}
        fieldBooked={props.match.fieldBooked}
        description={props.match.description}
        cancelReason={state.status === "Cancelled" ? props.match.cancelReason : null}
        status={state.status}
        captain={state.lineup.captain}
        slots={{
          filled:
            1 +
            props.match.captainCrew.length +
            state.lineup.accepted.reduce((n, p) => n + 1 + p.guest_count, 0),
          capacity: props.match.totalSpots,
        }}
      />

      <MatchCtaBar
        matchId={props.matchId}
        cta={cta}
        onManageClick={() => setCaptainSheetOpen(true)}
      />

      <MatchTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "lineup" ? (
        <LineupTab
          state={state}
          totalSpots={props.match.totalSpots}
          crew={props.match.captainCrew}
          viewerRole={props.viewerRole}
          matchId={props.matchId}
        />
      ) : (
        <ChatTab
          state={state}
          viewerRole={props.viewerRole}
          viewerId={props.viewerId}
          matchId={props.matchId}
          matchStatus={state.status}
          onMessageSent={(message: MatchStateMessage) =>
            setState((prev) => mergePollPayload(prev, mergeOneMessage(prev, message)))
          }
        />
      )}

      {captainSheetOpen && props.viewerRole === "captain" && (
        <CaptainSheet
          matchId={props.matchId}
          pending={state.lineup.pending}
          watchingCount={state.lineup.watching_count}
          free={
            props.match.totalSpots -
            (1 +
              props.match.captainCrew.length +
              state.lineup.accepted.reduce((n, p) => n + 1 + p.guest_count, 0))
          }
          onClose={() => setCaptainSheetOpen(false)}
          onChange={(updated) =>
            setState((prev) => ({ ...prev, lineup: updated }))
          }
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Merging helpers — kept in the shell because they own `state`.
// ---------------------------------------------------------------------------

function mergePollPayload(
  prev: MatchStateResponse,
  next: MatchStateResponse,
): MatchStateResponse {
  // Replace lineup + status + updated_at + watching_count + deleted wholesale
  // (the polling endpoint sends snapshots, not deltas, for these).
  // Merge messages by id — Ably (Layer 5.5) will deliver some via push and
  // some via the next poll; idempotent merge by id avoids duplicates.
  const byId = new Map<string, MatchStateMessage>();
  for (const m of prev.messages) byId.set(m.id, m);
  for (const m of next.messages) byId.set(m.id, m);
  const merged = [...byId.values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );
  return {
    messages: merged,
    lineup: next.lineup,
    status: next.status,
    updated_at: next.updated_at,
    deleted: next.deleted,
  };
}

function mergeOneMessage(
  prev: MatchStateResponse,
  message: MatchStateMessage,
): MatchStateResponse {
  return {
    ...prev,
    messages: [...prev.messages.filter((m) => m.id !== message.id), message],
  };
}

function wireToDomainStatus(
  wire: MatchStateResponse["status"],
): MatchStatus {
  switch (wire) {
    case "Open":
      return "open";
    case "AlmostFull":
      return "almostFull";
    case "Full":
      return "full";
    case "InProgress":
      return "inProgress";
    case "Ended":
      return "ended";
    case "Cancelled":
      return "cancelled";
  }
}
