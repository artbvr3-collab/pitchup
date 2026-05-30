/**
 * MODULE: ui.hooks.use-ably-channel
 * PURPOSE: Subscribe-only Ably client for a match's chat channel (Layer 5.5).
 *          Subscribes to `match:{matchId}:chat` on enable, unsubscribes on
 *          cleanup; surfaces `message_created` / `message_deleted` via
 *          callbacks and triggers a gap-fill on reconnect. Realtime is an
 *          enhancement over polling (spec §229) — this hook NO-OPS when the
 *          subscribe key is absent, so chat keeps working on polling alone.
 * LAYER: ui (client)
 * DEPENDENCIES: react (useEffect/useRef), ably (dynamic import — client only),
 *               src/chat/domain/chat-realtime-publisher (channel + event names
 *               + payload types — pure, shared with the server publisher).
 * CONSUMED BY: app/matches/[id]/match-shell.tsx
 * INVARIANTS:
 *   - `ably` is imported dynamically INSIDE the effect (browser-only, same
 *     pattern as MapLibre, AGENTS §155). Never import it at module top — it
 *     touches browser globals.
 *   - Subscribe key is read from `process.env.NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY`
 *     directly (NOT from `src/shared/config/env`, which is server-only and
 *     would leak server secrets into the bundle). Next inlines NEXT_PUBLIC_*.
 *   - Who subscribes is WIDER than who polls: captain + accepted + watching +
 *     guest (spec §244). Pending do not (caller gates `enabled`). The polling
 *     gate (captain + accepted only) is separate — do not conflate them.
 *   - clientId = signed-in user id, or a per-tab `anon-${uuid}` persisted in
 *     sessionStorage (spec §242) — survives in-tab navigation, ready for
 *     presence / typing when token auth lands.
 *   - Callbacks are kept in a ref so re-renders don't tear down the
 *     subscription; the effect only re-runs on `enabled`/`matchId`/`viewerId`.
 *   - Gap-fill: on `connected` AFTER `disconnected`/`suspended`, calls
 *     `onReconnect` (the caller refetches `GET /state?since=` — same path as
 *     polling, spec §246). Not fired on the initial connect.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Realtime chat transport" §227-256
 *   - docs/adr/0005-ably-realtime-chat-transport.md
 */
"use client";

import { useEffect, useRef } from "react";

import type { Realtime } from "ably";

import {
  CHAT_REALTIME_EVENTS,
  chatChannelName,
  type ChatMessageCreatedEvent,
  type ChatMessageDeletedEvent,
} from "@/src/chat/domain/chat-realtime-publisher";

const ANON_CLIENT_ID_KEY = "pitchup.ably_anon_id";

export interface UseAblyChannelOptions {
  readonly matchId: string;
  /**
   * When `false` the hook tears down any subscription and does nothing. Caller
   * gates this on `activeTab === 'chat' && role !== 'pending'` (spec §243-245).
   */
  readonly enabled: boolean;
  /** Signed-in user id, or `null` for guests (→ anon clientId). */
  readonly viewerId: string | null;
  readonly onMessageCreated: (event: ChatMessageCreatedEvent) => void;
  readonly onMessageDeleted: (event: ChatMessageDeletedEvent) => void;
  /** Fired on reconnect (post-drop) so the caller can gap-fill via polling. */
  readonly onReconnect: () => void;
}

/**
 * Resolve the Ably clientId. Signed-in users connect with their user id; guests
 * get a stable per-tab `anon-${uuid}` (sessionStorage). Called inside the
 * effect only — never during SSR render.
 */
function resolveClientId(viewerId: string | null): string {
  if (viewerId) return viewerId;
  try {
    const existing = sessionStorage.getItem(ANON_CLIENT_ID_KEY);
    if (existing) return existing;
    const fresh = `anon-${crypto.randomUUID()}`;
    sessionStorage.setItem(ANON_CLIENT_ID_KEY, fresh);
    return fresh;
  } catch {
    // sessionStorage blocked (private mode) — an ephemeral id is acceptable.
    return `anon-${crypto.randomUUID()}`;
  }
}

export function useAblyChannel(options: UseAblyChannelOptions): void {
  const { enabled, matchId, viewerId } = options;

  // Stash callbacks in a ref so changing them per-render doesn't re-subscribe.
  const cbRef = useRef(options);
  cbRef.current = options;

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY;
    if (!enabled || !key) return;

    let cancelled = false;
    let client: Realtime | null = null;

    void import("ably")
      .then((Ably) => {
        if (cancelled) return;

        client = new Ably.Realtime({
          key,
          clientId: resolveClientId(viewerId),
          // The client never publishes via Ably (all sends go through the REST
          // API); echo is irrelevant. Disable autoConnect cleanup races by
          // letting the SDK manage the single connection.
        });

        const channel = client.channels.get(chatChannelName(matchId));

        void channel.subscribe(CHAT_REALTIME_EVENTS.messageCreated, (msg) => {
          cbRef.current.onMessageCreated(msg.data as ChatMessageCreatedEvent);
        });
        void channel.subscribe(CHAT_REALTIME_EVENTS.messageDeleted, (msg) => {
          cbRef.current.onMessageDeleted(msg.data as ChatMessageDeletedEvent);
        });

        // Gap-fill on reconnect (spec §246) — only after a real drop, not the
        // first connect (which the static RSC snapshot already covers).
        client.connection.on("connected", (change) => {
          if (
            change.previous === "disconnected" ||
            change.previous === "suspended"
          ) {
            cbRef.current.onReconnect();
          }
        });
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console -- realtime is best-effort; polling carries chat.
        console.error("[ably] subscribe init failed", err);
      });

    return () => {
      cancelled = true;
      // close() tears down the connection and all channel subscriptions.
      if (client) client.close();
    };
  }, [enabled, matchId, viewerId]);
}
