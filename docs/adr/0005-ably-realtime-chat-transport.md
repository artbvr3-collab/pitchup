# ADR-0005: Ably pub/sub as the v1 realtime chat transport

- **Status:** Accepted
- **Date:** 2026-05-31
- **Deciders:** Pr1ce (owner) + Claude (Layer 5.5)

## Context

Match chat (Layer 5) already works end-to-end on **polling**: `GET
/api/matches/:id/state?since=ISO` carries new + soft-deleted messages alongside
lineup and status, at 15s foreground / 60s background. Polling is the source of
truth and the fallback. The remaining gap is **latency** — a message can take up
to 15s to appear. Layer 5.5 adds a realtime layer that delivers new and deleted
messages with <1s latency **without changing the data model, the write path, or
auth**.

The spec already fixed the high-level design (`docs/spec/pitchup-spec-match.md`
§227-256): Ably as a pub/sub message bus for v1, self-hosted Socket.io on the
VPS for v2. This ADR records the *code-side* decisions that the spec leaves
open — where the fan-out lives, what the port looks like, and the failure
semantics — symmetrically to ADR-0004 (Resend email).

Two constraints shape it:

1. **Realtime must never weaken the existing guarantees.** A provider outage,
   a blocked network, or a missing key must degrade silently to polling. The
   persisted `ChatMessage` row stays authoritative.
2. **The transport must be swappable.** v2 replaces Ably with Socket.io; that
   should be an adapter swap, not a rewrite of the chat domain.

## Decision

1. **Ably as pub/sub only**, not the Ably Chat SDK. History, persistence,
   moderation, read-receipts all stay in Postgres. Ably is a dumb bus. Channel
   per match: `match:{matchId}:chat` (spec §232).

2. **`ChatRealtimePublisher` domain port** (`src/chat/domain/`) with two methods
   — `publishMessageCreated` / `publishMessageDeleted`. Two adapters in
   `src/chat/infrastructure/`:
   - `AblyChatRealtimePublisher` — `Ably.Rest` (no persistent connection needed
     for fire-and-forget publish), keyed by `ABLY_API_KEY`.
   - `NoopChatRealtimePublisher` — when `ABLY_API_KEY` is absent.

   A singleton picker (`chat-realtime-publisher.ts`) chooses by key presence —
   the exact shape of `emailSender` from ADR-0004. The two write services depend
   on the **port**, never on the adapter.

3. **Fan-out lives in the application service, after persistence, best-effort.**
   `PostChatMessageService` / `DeleteChatMessageService` publish *after* the row
   is written (chat is a no-lock write — there is no transaction to commit
   inside, the `insert` / `softDelete` is already durable when `await` returns).
   The publish is wrapped in `try/catch` + `console.error` in the **service**
   (mirrors ADR-0004's post-commit email send): a publish failure is logged and
   swallowed, the endpoint still returns 200 with the persisted row. Polling
   delivers the message within 15s regardless.

   The spec prose says "the route fans out" (§233); we put it in the service
   instead because that is where the `// TODO(Layer 5.5)` markers already sat,
   and it keeps the route handler a thin parse-validate-call-map shell with no
   infrastructure import. Behaviourally identical.

4. **Event shape matches the spec verbatim** (§235-236):
   - `message_created` → `{ id, author_id, text, created_at }`
   - `message_deleted` → `{ id, deleted_at }`

   Note `message_created` carries `author_id` (raw), **not** the resolved author
   object that `messages[]` in the poll payload carries. The client resolves
   `author_id` against the lineup it already holds (captain + accepted players);
   if the author isn't in that snapshot yet (a just-approved player posting), the
   next poll / gap-fill resolves it. This is the spec's deliberate trade — no
   author read inside the publish path.

5. **Subscribe-only key on the client.** `NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY`
   (capability `{"*": ["subscribe", "history"]}`) ships in the bundle; it cannot
   publish, so it cannot be abused for spam. No Ably token auth in v1 (spec
   §241). `clientId` = `session.user.id` for signed-in, `anon-${uuid}`
   (sessionStorage) for guests (spec §242).

6. **Who subscribes is wider than who polls.** Captain + accepted + **watching +
   guest** subscribe on Tab Chat mount; pending do not (spec §243-245). Polling
   stays gated to captain + accepted. The `useAblyChannel` hook is gated
   `activeTab === 'chat' && role !== 'pending'`.

7. **Gap-fill on reconnect** (§246): on an Ably `connected` transition *after* a
   `disconnected`/`suspended`, the client fires an immediate `GET /state?since=`
   — the same code path as polling. No separate catch-up branch. Dedup is by
   message `id` (already in the client merge).

8. **Poll cadence is unchanged** when Ably is connected (§248). Lineup + status +
   `deleted` still ride the poll; only chat messages get the realtime overlay.

## Consequences

- New dependency `ably` (2.x). Server uses `Ably.Rest`; client dynamically
  imports `ably` inside a `useEffect` (client-only, same pattern as MapLibre).
- Two optional env vars (`ABLY_API_KEY`, `NEXT_PUBLIC_ABLY_SUBSCRIBE_KEY`). The
  app boots without them — publisher resolves to Noop, the client hook no-ops,
  chat runs on polling. Real-time activates the moment both keys are present.
- The client `MessageRow` now derives its deleted state from the prop (`deleted
  = message.deleted_at !== null || locallyDeleted`) rather than a one-shot
  `useState`. Without this, a realtime (or poll) deletion would be invisible to
  non-captain viewers — a latent bug from Layer 5 that the realtime overlay
  surfaces.
- Live publish/subscribe handshake is verified by the owner against a real Ably
  channel (keys are owner-provided; the same live-test ownership as Google
  OAuth). Unit tests cover the service → port contract (correct payload, failure
  swallowed); the `useAblyChannel` hook is not unit-tested (DOM + Ably runtime).

## References

- Spec: `docs/spec/pitchup-spec-match.md` → "Realtime chat transport" §227-256.
- ADR-0004 (the symmetric port + singleton + best-effort pattern for email).
- Code: `src/chat/domain/chat-realtime-publisher.ts`,
  `src/chat/infrastructure/`, `src/ui/hooks/use-ably-channel.ts`,
  `app/matches/[id]/match-shell.tsx`.
