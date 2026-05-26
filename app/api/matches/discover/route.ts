/**
 * MODULE: app.api.matches.discover.route
 * PURPOSE: Public, paged read of upcoming matches with the same filter
 *          contract as the `/games` Server Component. Used by the client-side
 *          `[Show more]` button to fetch subsequent cursor pages without a
 *          full RSC re-render. The Server Component still owns the first page.
 * LAYER: interfaces (Route Handler)
 * DEPENDENCIES: src/match_lifecycle/composition, src/match_lifecycle/application/*
 * INVARIANTS:
 *   - Guest-accessible: no `requireAuth()` call. `/games` itself is public,
 *     so the JSON read must match.
 *   - All filter parsing goes through `parseDiscoverFilters` — never read
 *     `searchParams` ad-hoc here. Invalid params silently fall back to
 *     defaults per spec ("Invalid query params fallback").
 *   - Response dates are ISO-8601 strings; cursor is the opaque base64url
 *     payload. The client renders Prague-TZ formats from the ISO strings.
 * RELATED DOCS: ADR-0001 (Route Handlers default),
 *               docs/spec/pitchup-spec-discovery.md → "/games" → "Pagination".
 */
import { NextResponse } from "next/server";

import {
  encodeCursor,
  parseDiscoverFilters,
} from "@/src/match_lifecycle/application/discover-filters";
import type { DiscoverMatchView } from "@/src/match_lifecycle/application/list-discover-matches";
import { listDiscoverMatchesService } from "@/src/match_lifecycle/composition";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const now = new Date();
  const filters = parseDiscoverFilters(url.searchParams, { now });
  const location = readLocationParam(url.searchParams);

  const page = await listDiscoverMatchesService.execute({
    filters,
    limit: PAGE_SIZE,
    now,
    location,
  });

  return NextResponse.json({
    rows: page.rows.map(serializeRow),
    nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
  });
}

function readLocationParam(
  params: URLSearchParams,
): { lat: number; lng: number } | null {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function serializeRow(view: DiscoverMatchView): SerializedDiscoverRow {
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

export interface SerializedDiscoverRow {
  readonly id: string;
  readonly startTime: string;
  readonly duration: number;
  readonly surface: DiscoverMatchView["surface"];
  readonly studsAllowed: boolean;
  readonly fieldBooked: boolean;
  readonly price: number;
  readonly coverId: string;
  readonly venue: DiscoverMatchView["venue"];
  readonly slots: DiscoverMatchView["slots"];
  readonly status: DiscoverMatchView["status"];
}

export interface DiscoverPageResponse {
  readonly rows: readonly SerializedDiscoverRow[];
  readonly nextCursor: string | null;
}
