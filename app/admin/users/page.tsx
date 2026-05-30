/**
 * MODULE: app.admin.users.page
 * PURPOSE: `/admin/users` Server Component. Reads the filtered user list +
 *          active-admin count, maps rows to a serialisable shape, and renders
 *          the filter island + the table island. The table handles all row
 *          actions; this page is pure read.
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (requireAdminPage + userRepository),
 *               ./admin-users-filters, ./admin-users-table
 * INVARIANTS:
 *   - Admin-only via `requireAdminPage()` (middleware already gated; backstop).
 *   - Filters are whitelist-parsed — unknown `?admin=`/`?status=` values fall
 *     back to "no filter" (never 4xx; same lenient convention as Discover).
 *   - `activeAdminCount` drives the per-row sole-admin disable mirror in the
 *     table; `currentAdminId` drives the `(you)` self-row mirror.
 *   - Row cap of 200 (no pagination island in 9a — admin data volume is tiny;
 *     a keyset "Show more" can be added when scale demands). // TODO(scale)
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin/users".
 */
import { requireAdminPage, userRepository } from "@/src/auth/composition";

import { AdminUsersFilters } from "./admin-users-filters";
import { AdminUsersTable, type AdminUserRow } from "./admin-users-table";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOINED_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Prague",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const ROW_LIMIT = 200;

type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const admin = await requireAdminPage();
  const sp = await searchParams;

  const search = one(sp.q)?.trim();
  const adminRaw = one(sp.admin);
  const statusRaw = one(sp.status);
  const adminFilter = adminRaw === "yes" || adminRaw === "no" ? adminRaw : undefined;
  const statusFilter =
    statusRaw === "active" || statusRaw === "banned" ? statusRaw : undefined;

  const [users, activeAdminCount] = await Promise.all([
    userRepository.listForAdmin({
      ...(search ? { search } : {}),
      ...(adminFilter ? { adminFilter } : {}),
      ...(statusFilter ? { statusFilter } : {}),
      limit: ROW_LIMIT,
    }),
    userRepository.countActiveAdmins(),
  ]);

  const rows: AdminUserRow[] = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl,
    joinedLabel: JOINED_FORMAT.format(u.createdAt),
    isAdmin: u.isAdmin,
    banned: u.banned,
  }));

  return (
    <div className="flex flex-col">
      <AdminUsersFilters />
      <AdminUsersTable
        rows={rows}
        currentAdminId={admin.userId}
        activeAdminCount={activeAdminCount}
      />
    </div>
  );
}
