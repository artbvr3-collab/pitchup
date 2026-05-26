/**
 * MODULE: app.(public).games.page
 * PURPOSE: Public Discover feed. Reads URL filters server-side via the
 *          canonical parser, fetches the first page from the
 *          `ListDiscoverMatchesService`, then hands the rendered state to a
 *          client shell that owns ephemeral search + cursor pagination.
 *          This is the first URL-driven Server Component fetch in the
 *          codebase (Layer 2.5).
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/match_lifecycle/composition,
 *               src/match_lifecycle/application/discover-filters,
 *               src/shared/time/prague, ./discover-shell
 * INVARIANTS:
 *   - Accessible to guests; middleware whitelists `/games`.
 *   - Distance filter is silently dropped server-side (no localStorage). The
 *     client shell + DistanceBanner surface the situation.
 *   - The `key` on `DiscoverShell` includes all sticky URL filters so the
 *     shell remounts (and re-seeds its internal state) on any URL change —
 *     prevents stale rows / cursor when the user changes day or applies a
 *     new sheet filter.
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games",
 *               docs/ROADMAP.md → Layer 2.5.
 */
import {
  discoverHorizonDates,
  encodeCursor,
  parseDiscoverFilters,
} from "@/src/match_lifecycle/application/discover-filters";
import { listDiscoverMatchesService } from "@/src/match_lifecycle/composition";
import { todayPrague } from "@/src/shared/time/prague";

import { DiscoverShell } from "./discover-shell";
import type { DiscoverInitialState, DiscoverRow } from "./discover-types";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE_SIZE = 50;

export default async function GamesPage(props: PageProps) {
  const sp = await props.searchParams;
  const now = new Date();
  const filters = parseDiscoverFilters(sp, { now });
  const today = todayPrague(now);
  const horizonDates = discoverHorizonDates(today);

  const page = await listDiscoverMatchesService.execute({
    filters,
    limit: PAGE_SIZE,
    now,
    // SSR has no access to localStorage — distance filter is dropped here
    // and re-applied via the client shell after hydration if a location is
    // saved.
    location: null,
  });

  const initial: DiscoverInitialState = {
    date: filters.date,
    today,
    horizonDates,
    distanceKm: filters.distanceKm,
    timeOfDay: filters.timeOfDay,
    gameSize: [...filters.gameSize] as DiscoverInitialState["gameSize"],
    spotsLeft: filters.spotsLeft,
    freeOnly: filters.freeOnly,
    fieldBookedOnly: filters.fieldBookedOnly,
    page: {
      rows: page.rows.map(toRow),
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
    },
  };

  const remountKey = [
    filters.date,
    filters.distanceKm,
    filters.timeOfDay.join(","),
    filters.gameSize.join(","),
    filters.spotsLeft,
    filters.freeOnly,
    filters.fieldBookedOnly,
  ].join("|");

  return <DiscoverShell key={remountKey} initial={initial} />;
}

function toRow(view: Awaited<ReturnType<typeof listDiscoverMatchesService.execute>>["rows"][number]): DiscoverRow {
  return {
    id: view.id,
    startTime: view.startTime.toISOString(),
    duration: view.duration,
    surface: view.surface,
    studsAllowed: view.studsAllowed,
    fieldBooked: view.fieldBooked,
    price: view.price,
    coverId: view.coverId,
    venue: view.venue,
    slots: view.slots,
    status: view.status,
  };
}
