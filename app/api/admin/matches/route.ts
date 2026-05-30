/**
 * MODULE: app.api.admin.matches.route
 * PURPOSE: `GET /api/admin/matches` — admin match list with optional search
 *          and status filter. Returns ≤200 rows sorted start_time DESC.
 * LAYER: interfaces
 * INVARIANTS:
 *   - `requireAdmin()` — 401/403 for non-admins.
 *   - Query params are whitelist-parsed and never 400 (same convention as
 *     Discover filters — invalid values are silently dropped).
 *   - `?q=` search is trimmed; empty = no search.
 *   - `?status=` is a comma-separated list of status values; unknown values
 *     are dropped.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches"
 */
import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin } from "@/src/auth/composition";
import {
  listAdminMatchesService,
  type AdminMatchStatus,
} from "@/src/match_lifecycle/composition";
import { toHttpResponse } from "@/src/shared/errors/http-mapping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<AdminMatchStatus>([
  "open", "almostFull", "full", "inProgress", "ended", "cancelled",
]);

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const search = (url.searchParams.get("q") ?? "").trim();
    const rawStatus = url.searchParams.get("status") ?? "";
    const statusFilter = rawStatus
      .split(",")
      .map((s) => s.trim())
      .filter((s): s is AdminMatchStatus => VALID_STATUSES.has(s as AdminMatchStatus));

    const rows = await listAdminMatchesService.execute({
      search,
      statusFilter,
      now: new Date(),
    });

    return NextResponse.json({ matches: rows }, { status: 200 });
  } catch (err) {
    return toHttpResponse(err);
  }
}
