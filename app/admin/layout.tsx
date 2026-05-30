/**
 * MODULE: app.admin.layout
 * PURPOSE: Shell for the admin panel. Server Component — runs the
 *          `requireAdminPage()` backstop (redirects guests → /login, non-admins
 *          → /my-matches) and frames every `/admin/*` page with a header + the
 *          four-tab AdminBottomNav. The public BottomNav + SignedInChrome do
 *          NOT render here (BottomNav hides on /admin; SignedInChrome self-gates
 *          to /my-matches /me /games).
 * LAYER: interfaces (Server Component)
 * DEPENDENCIES: src/auth/composition (requireAdminPage), ./admin-bottom-nav
 * INVARIANTS:
 *   - Admin-only. Middleware already enforces it before render; this layout's
 *     `requireAdminPage()` is the defence-in-depth backstop.
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin".
 */
import { requireAdminPage } from "@/src/auth/composition";

import { AdminBottomNav } from "./admin-bottom-nav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdminPage();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center border-b border-border px-4">
        <span className="text-[15px] font-bold tracking-tight">
          PITCH<span className="rounded bg-lime px-1 text-lime-text">UP</span>
          <span className="ml-2 font-medium text-text-secondary">Admin</span>
        </span>
      </header>
      <main className="flex-1 overflow-x-hidden">{children}</main>
      <AdminBottomNav />
    </div>
  );
}
