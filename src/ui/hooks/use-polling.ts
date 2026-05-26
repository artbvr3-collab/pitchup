/**
 * MODULE: ui.hooks.use-polling
 * PURPOSE: Visibility-aware polling hook. Fires a fetch every 15s while the
 *          tab is foregrounded, every 60s when backgrounded (`visibilityState
 *          === 'hidden'`). Exponential back-off on error (cap 60s). Aborts
 *          the in-flight request on unmount or when the effect re-runs.
 *          Layer 5 — used by `ChatTab` and the polling state assembler.
 * LAYER: ui (client)
 * DEPENDENCIES: react (useEffect / useRef / useState)
 * CONSUMED BY: src/chat/ui/chat-tab.tsx,
 *              src/match_lifecycle/ui/match-tabs.tsx (delta lineup updates).
 * INVARIANTS:
 *   - Cadence 15s foreground / 60s background — both intervals defined in
 *     spec global.md → "Polling sync". Do NOT shorten when realtime is
 *     wired in Layer 5.5 (spec match.md §248: poll cadence unchanged on
 *     Ably connect).
 *   - Back-off: 1s → 2s → 4s → 8s → 16s → 32s → 60s (capped). Resets on the
 *     first successful response.
 *   - Aborts in-flight requests on unmount and when `url` changes. Prevents
 *     setting state on an unmounted component.
 *   - `onPayload` callback receives the parsed JSON. `onError` is optional
 *     and is invoked once per failure; the hook itself does not log.
 *   - `since` is a serialisation-controlled cursor passed from the parent.
 *     The hook does NOT manage `since` internally — the parent merges the
 *     poll payload and decides the next cursor (e.g. last message
 *     `created_at`).
 *   - Returns `{ state, error }` for UIs that want to show a "polling…" or
 *     "offline" indicator (Layer 5 doesn't need this yet but the surface
 *     stays available for free).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-global.md → "Polling sync"
 *   - docs/spec/pitchup-spec-match.md → "Polling for match state"
 */
"use client";

import { useEffect, useRef, useState } from "react";

export type PollingState = "idle" | "polling" | "error";

export interface UsePollingOptions<T> {
  /** Endpoint to poll. Should already include any query string. */
  readonly url: string;
  /**
   * Callback invoked with the parsed JSON on every successful response.
   * The parent merges the payload into its local state.
   */
  readonly onPayload: (payload: T) => void;
  /** Optional error callback. Invoked once per failed cycle. */
  readonly onError?: (error: unknown) => void;
  /**
   * When `false`, the hook is paused — no requests fire. Use this to gate
   * polling on viewer membership (e.g. pending/watching shouldn't poll
   * per spec §215-216). When the flag flips back to `true` the next cycle
   * fires immediately.
   */
  readonly enabled: boolean;
}

export interface UsePollingResult {
  readonly state: PollingState;
  readonly lastError: unknown;
}

const FOREGROUND_INTERVAL_MS = 15_000;
const BACKGROUND_INTERVAL_MS = 60_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

export function usePolling<T>(options: UsePollingOptions<T>): UsePollingResult {
  const { url, onPayload, onError, enabled } = options;
  const [state, setState] = useState<PollingState>("idle");
  const [lastError, setLastError] = useState<unknown>(null);

  // Stash callbacks in refs so changes to them don't restart the cycle.
  const onPayloadRef = useRef(onPayload);
  const onErrorRef = useRef(onError);
  onPayloadRef.current = onPayload;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!enabled) {
      setState("idle");
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    const tick = async () => {
      if (cancelled) return;
      controller = new AbortController();
      setState("polling");
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          cache: "no-store",
          credentials: "same-origin",
        });
        if (!response.ok) {
          throw new PollingHttpError(response.status, response.statusText);
        }
        const payload = (await response.json()) as T;
        if (cancelled) return;
        onPayloadRef.current(payload);
        setState("idle");
        setLastError(null);
        backoffMs = INITIAL_BACKOFF_MS;
        schedule(nextDelay());
      } catch (err) {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLastError(err);
        setState("error");
        onErrorRef.current?.(err);
        schedule(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    };

    const schedule = (delay: number) => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void tick();
      }, delay);
    };

    const nextDelay = () =>
      typeof document !== "undefined" && document.visibilityState === "hidden"
        ? BACKGROUND_INTERVAL_MS
        : FOREGROUND_INTERVAL_MS;

    // Fire immediately, then run on a timer.
    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      controller?.abort();
    };
  }, [url, enabled]);

  return { state, lastError };
}

/**
 * Lightweight Error subclass so callers can `instanceof` to distinguish HTTP
 * errors from network ones (e.g. for a 401 → redirect handler).
 */
export class PollingHttpError extends Error {
  constructor(
    public readonly status: number,
    statusText: string,
  ) {
    super(`Polling failed: HTTP ${status} ${statusText}`);
    this.name = "PollingHttpError";
  }
}
