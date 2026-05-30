/**
 * MODULE: app.matches.id.chat-tab
 * PURPOSE: Chat tab — feed + composer + captain inline delete. Role-gated
 *          (spec §215-217). Polling is owned by the shell — this component
 *          only renders the state slice it receives and posts messages.
 * LAYER: interfaces (client)
 * INVARIANTS:
 *   - Composer visible only to captain + accepted. Pending sees a tooltip
 *     "Wait for captain approval to chat" (the tab itself remains visible
 *     so users can still read pre-pending discussion — spec §216).
 *   - Cancelled match → composer hidden, "Chat closed · match cancelled"
 *     hint below the feed (spec §224).
 *   - Captain can `[Delete]` any message via DELETE endpoint; soft-deleted
 *     messages render as tombstones (text replaced with "[Message deleted]"
 *     and italic style).
 *   - Optimistic insert on POST: composer adds the message to the shell's
 *     state on success; polling reconciles on the next cycle.
 *   - Banned authors render as `[Removed user]` per spec §220.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Tab Chat", §215-225
 */
"use client";

import { useState } from "react";

import type {
  MatchStateMessage,
  MatchStateMessageAuthor,
  MatchStateResponse,
  MatchStateWireStatus,
} from "@/src/match_lifecycle/application/dto/match-state";
import type { ViewerRole } from "@/src/match_lifecycle/domain/compute-cta";
import { Button } from "@/src/ui/components/button";
import { cn } from "@/src/ui/lib/cn";

export interface ChatTabProps {
  readonly state: MatchStateResponse;
  readonly viewerRole: ViewerRole;
  readonly viewerId: string | null;
  readonly matchId: string;
  readonly matchStatus: MatchStateWireStatus;
  readonly onMessageSent: (message: MatchStateMessage) => void;
}

export function ChatTab(props: ChatTabProps) {
  const canCompose =
    props.matchStatus !== "Cancelled" &&
    (props.viewerRole === "captain" || props.viewerRole === "accepted");
  const isPending = props.viewerRole === "pending";

  return (
    <div className="flex flex-col gap-3">
      {isPending && (
        <p
          className="text-center text-xs text-text-muted"
          title="Wait for captain approval to chat"
        >
          Wait for captain approval to chat
        </p>
      )}

      <Feed
        messages={props.state.messages}
        isCaptain={props.viewerRole === "captain"}
        viewerId={props.viewerId}
        matchId={props.matchId}
      />

      {props.matchStatus === "Cancelled" ? (
        <p className="text-center text-xs text-text-muted">
          Chat closed · match cancelled
        </p>
      ) : canCompose ? (
        <Composer
          matchId={props.matchId}
          onSent={props.onMessageSent}
        />
      ) : props.viewerRole === "watching" ? (
        <p className="text-center text-xs text-text-muted">
          Join the match to chat
        </p>
      ) : null}
    </div>
  );
}

function Feed({
  messages,
  isCaptain,
  viewerId,
  matchId,
}: {
  messages: readonly MatchStateMessage[];
  isCaptain: boolean;
  viewerId: string | null;
  matchId: string;
}) {
  if (messages.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">
        No messages yet
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          isCaptain={isCaptain}
          isOwn={viewerId !== null && m.author?.id === viewerId}
          matchId={matchId}
        />
      ))}
    </div>
  );
}

function MessageRow({
  message,
  isCaptain,
  isOwn,
  matchId,
}: {
  message: MatchStateMessage;
  isCaptain: boolean;
  isOwn: boolean;
  matchId: string;
}) {
  // Derive `deleted` from the prop so a deletion arriving via poll OR the
  // Layer 5.5 realtime overlay is visible to NON-captain viewers too. The
  // local flag is only the captain's optimistic feedback before the round-trip
  // (without the prop-derive, a one-shot useState would never see a deletion
  // pushed in by someone else — a latent Layer 5 bug surfaced by realtime).
  const [locallyDeleted, setLocallyDeleted] = useState(false);
  const deleted = message.deleted_at !== null || locallyDeleted;
  const [busy, setBusy] = useState(false);
  const author = resolveAuthor(message.author);
  const time = new Date(message.created_at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const handleDelete = async () => {
    if (!confirm("Delete this message?")) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/matches/${matchId}/messages/${message.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { code?: string }
          | null;
        alert(`Delete failed: ${body?.code ?? res.status}`);
        return;
      }
      setLocallyDeleted(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-2">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-text-inverted",
          author.removed ? "bg-text-muted" : "bg-green-dark",
        )}
      >
        {author.initials}
      </div>
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold">{author.name}</span>
          {isOwn ? (
            <span className="text-[10px] text-text-muted">you</span>
          ) : null}
          <span className="text-xs text-text-muted">{time}</span>
        </div>
        {deleted ? (
          <p className="text-sm italic text-text-muted">[Message deleted]</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{message.text}</p>
        )}
      </div>
      {isCaptain && !deleted && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={busy}
          title="Delete message"
          className="text-xs text-destructive opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      )}
    </div>
  );
}

function Composer({
  matchId,
  onSent,
}: {
  matchId: string;
  onSent: (msg: MatchStateMessage) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/matches/${matchId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { code?: string }
          | null;
        alert(`Send failed: ${body?.code ?? res.status}`);
        return;
      }
      const persisted = (await res.json()) as {
        id: string;
        text: string;
        created_at: string;
        deleted_at: string | null;
      };
      onSent({
        id: persisted.id,
        text: persisted.text,
        created_at: persisted.created_at,
        deleted_at: persisted.deleted_at,
        // Author resolution comes on the next poll; render anonymously
        // until then. Optimistic — keeps the bubble visible immediately.
        author: null,
      });
      setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex items-end gap-2"
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a message…"
        maxLength={2000}
        rows={2}
        className="flex-1 resize-none rounded-btn border border-border bg-bg-card px-3 py-2 text-sm text-text-primary focus:border-border-focus focus:outline-none"
      />
      <Button
        type="submit"
        variant="primary"
        size="md"
        disabled={busy || text.trim().length === 0}
        className="w-auto px-4"
      >
        Send
      </Button>
    </form>
  );
}

function resolveAuthor(author: MatchStateMessageAuthor | null): {
  name: string;
  initials: string;
  removed: boolean;
} {
  if (!author) return { name: "[Removed user]", initials: "?", removed: true };
  if (author.banned)
    return { name: "[Removed user]", initials: "?", removed: true };
  const parts = author.name.trim().split(/\s+/).filter(Boolean);
  const initials =
    parts.length === 0
      ? "?"
      : parts.length === 1
        ? parts[0]!.slice(0, 2).toUpperCase()
        : (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return { name: author.name, initials, removed: false };
}
