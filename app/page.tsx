/**
 * MODULE: app.page
 * PURPOSE: Placeholder root page at Layer 0. Will be replaced by the public
 *          landing / `/games` redirect logic once Layer 1 (auth) lands.
 *          Currently just points the curious visitor at the live component
 *          catalog.
 * LAYER: interfaces
 */
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 py-8 text-center">
      <h1 className="text-2xl font-bold text-text-primary">PITCHUP</h1>
      <p className="text-sm text-text-secondary">
        Bare scaffold (Layer 0). No auth, no DB, no business logic yet.
      </p>
      <Link
        href="/design"
        className="inline-flex h-12 items-center justify-center rounded-btn bg-green-dark px-6 text-[15px] font-semibold text-text-inverted shadow-btn hover:bg-green-mid"
      >
        Open /design catalog
      </Link>
    </main>
  );
}
