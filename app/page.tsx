/**
 * MODULE: app.page
 * PURPOSE: Root route. Redirects to `/games`, the public Discover feed — the
 *          canonical entry point for guests and signed-in users alike. The old
 *          Layer-0 scaffold rendered a placeholder landing; now that the app is
 *          live, `/` lands straight on real content.
 * LAYER: interfaces
 * RELATED DOCS: docs/spec/pitchup-spec-discovery.md → "/games".
 */
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/games");
}
