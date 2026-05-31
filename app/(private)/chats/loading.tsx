/**
 * MODULE: app.(private).chats.loading
 * PURPOSE: Route-level loading UI for `/chats` — 5 pulsing placeholder cards
 *          while the Server Component fetches the chat list (spec personal.md
 *          "/chats" → States → "Loading: 4–6 skeleton cards").
 * LAYER: interfaces (Server Component — App Router loading boundary)
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/chats" → "States"
 */
export default function ChatsLoading() {
  return (
    <main className="mx-auto w-full max-w-[375px] px-4 pb-12 pt-4">
      <div className="mb-4 h-7 w-24 animate-pulse rounded-card bg-bg-card" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-[132px] animate-pulse rounded-card bg-bg-card shadow-card"
          />
        ))}
      </div>
    </main>
  );
}
