/**
 * MODULE: app.admin.page
 * PURPOSE: Bare `/admin` → canonical first tab `/admin/users`. The middleware
 *          already performs this redirect for admins; this page is the backstop
 *          for any client-side navigation that reaches the route directly.
 * LAYER: interfaces (Server Component)
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md → "/admin" → Access
 *               ("/admin without a suffix → redirect to /admin/users").
 */
import { redirect } from "next/navigation";

export default function AdminIndexPage() {
  redirect("/admin/users");
}
