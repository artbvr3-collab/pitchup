/**
 * MODULE: app.(private).chats.chat-match-card
 * PURPOSE: One row of the `/chats` list — the canonical MatchCard, deep-linked
 *          to its Chat tab (`?tab=chat`), with an unread dot in the top-right
 *          corner when the chat has messages the viewer hasn't read.
 * LAYER: interfaces (Server Component — pure presentational, no state)
 * DEPENDENCIES: src/match_lifecycle/application/dto/my-chats (MyChatCardDto),
 *               src/ui/components/match-card
 * INVARIANTS:
 *   - The dot is rendered on a `relative` wrapper, NOT inside MatchCard —
 *     MatchCard is `overflow-hidden`, which would clip an outer-corner dot.
 *     `pointer-events-none` keeps the whole card a single click target.
 *   - Tap → `/matches/:id?tab=chat` so the user lands directly on the chat
 *     (spec personal.md "/chats" → MatchCard action; deep-link handled by
 *     match.md "Deep-link ?tab=chat").
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/chats"
 */
import type { MyChatCardDto } from "@/src/match_lifecycle/application/dto/my-chats";
import { MatchCard } from "@/src/ui/components/match-card";

export function ChatMatchCard({ card }: { card: MyChatCardDto }) {
  return (
    <div className="relative">
      <MatchCard
        href={`/matches/${card.match.id}?tab=chat`}
        coverId={card.match.coverId}
        photoUrl={card.match.venue.photoUrl}
        venueName={card.match.venue.name}
        venueAddress={card.match.venue.address}
        startTime={card.match.startTime}
        duration={card.match.duration}
        surface={card.match.surface}
        studsAllowed={card.match.studsAllowed}
        fieldBooked={card.match.fieldBooked}
        price={card.match.price}
        status={card.matchStatus}
        slots={card.slots}
        {...(card.lastMessage && {
          chatPreview: card.lastMessage.isOwn
            ? `You: ${card.lastMessage.text}`
            : card.lastMessage.text,
        })}
      />
      {card.unread && (
        <span
          aria-label="Unread messages"
          className="pointer-events-none absolute -right-1 -top-1 z-10 h-3 w-3 rounded-full bg-lime ring-2 ring-bg-base"
        />
      )}
    </div>
  );
}
