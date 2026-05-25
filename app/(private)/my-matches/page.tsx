/**
 * MODULE: app.(private).my-matches.page
 * PURPOSE: Layer-1 placeholder for `/my-matches`. Exists so middleware and
 *          the onboarding redirect have a valid post-auth target. Real screen
 *          (Upcoming / Captain / Past sections) lands in Layer 6.
 * LAYER: interfaces
 * DEPENDENCIES: src/auth/composition
 * RELATED DOCS: docs/spec/pitchup-spec-personal.md "/my-matches", Layer 6 in
 *               docs/ROADMAP.md.
 */
import { requireAuth } from "@/src/auth/composition";

export default async function MyMatchesPage() {
  const me = await requireAuth();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[24px] font-extrabold tracking-[-0.02em] text-green-dark">
        Hello, {me.name}
      </h1>
      <p className="mt-3 text-[14px] text-text-secondary">
        Your matches will live here. Coming in Layer 6.
      </p>
    </main>
  );
}
