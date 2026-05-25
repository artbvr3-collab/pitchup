/**
 * MODULE: vitest.config
 * PURPOSE: Vitest entrypoint. Loads TS path aliases from tsconfig.json so
 *          `@/...` imports resolve the same way as in app code. Node
 *          environment, no globals — tests import describe/it/expect/vi
 *          explicitly from "vitest".
 * LAYER: build config
 * DEPENDENCIES: vitest, vite-tsconfig-paths, tsconfig.json
 * CONSUMED BY: package.json scripts ("test", "test:watch")
 * INVARIANTS:
 *   - Tests live under tests/ and mirror the src/ layout.
 *   - No DB / network / Prisma imports inside test files (Layer 1 unit
 *     suite). Integration tests will get a separate config when added.
 * RELATED DOCS: CODING_STANDARDS.md §9 (Testing), docs/ROADMAP.md "Layer 1 Etap F".
 */
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
});
