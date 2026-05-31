/**
 * MODULE: app.(private).chats.page
 * PURPOSE: `/chats` Server Component — the aggregator of every match chat the
 *          signed-in user can access (accepted or captain, past + cancelled
 *          included), sorted by chat activity, each card deep-linked to its
 *          Chat tab with an unread dot. Empty state when the user has no chat
 *          access yet.
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (requireAuth),
 *               src/match_lifecycle/composition (listMyChatsService)
 * INVARIANTS:
 *   - Auth-only (spec personal.md "/chats content is auth-only"). Uses
 *     `requireAuth` (throwing); middleware already bounces guests to
 *     /login?callbackUrl=/chats.
 *   - No filters / search bar — the list is the user's own matches, not the
 *     public feed (spec "/chats" → Layout).
 *   - Live updates: SignedInChrome's global poll calls `router.refresh()` on
 *     `matches_changed`, which re-runs this RSC (card appears on approve,
 *     disappears on kick/leave). New chat messages do NOT drive this — sort
 *     order + unread dots recompute on each render (spec "/chats" → "Live
 *     updates", an intentional MVP simplification).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/chats"
 *   - docs/ROADMAP.md → /chats slice
 */
import Link from "next/link";

import { requireAuth } from "@/src/auth/composition";
import { listMyChatsService } from "@/src/match_lifecycle/composition";

import { ChatMatchCard } from "./chat-match-card";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  const me = await requireAuth();
  const { chats } = await listMyChatsService.execute({ userId: me.userId }, new Date());

  if (chats.length === 0) {
    return <EmptyState />;
  }

  return (
    <main className="mx-auto w-full max-w-[375px] px-4 pb-12 pt-4">
      <h1 className="mb-4 text-[22px] font-bold leading-tight tracking-tight text-text-primary">
        Chats
      </h1>
      <div className="space-y-3">
        {chats.map((card) => (
          <ChatMatchCard key={card.match.id} card={card} />
        ))}
      </div>
    </main>
  );
}

function EmptyState() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[375px] flex-col items-center justify-center px-6 text-center">
      <div className="text-[60px] leading-none" aria-hidden>
        💬
      </div>
      <h1 className="mt-4 text-[22px] font-bold tracking-tight text-text-primary">
        No conversations yet
      </h1>
      <p className="mt-2 text-[14px] text-text-secondary">
        Join a match to start chatting.
      </p>
      <div className="mt-6 w-full">
        <Link
          href="/games"
          className="inline-flex h-12 w-full items-center justify-center rounded-btn bg-green-dark px-6 text-[15px] font-semibold text-text-inverted shadow-btn transition-colors hover:bg-green-mid"
        >
          Find a match →
        </Link>
      </div>
    </main>
  );
}
