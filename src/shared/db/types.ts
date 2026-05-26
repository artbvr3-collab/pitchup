/**
 * MODULE: shared.db.types
 * PURPOSE: Cross-context alias for Prisma's transactional client. Repository
 *          ports accept this type when they need to participate in a caller-
 *          controlled transaction (advisory-lock critical sections).
 *          This is the ONE place a Prisma type leaks into port signatures —
 *          accepted per ADR-0003 because the locking model is Postgres-specific.
 * LAYER: shared (infrastructure type-only)
 * DEPENDENCIES: @prisma/client
 * CONSUMED BY: domain ports that accept a `tx` parameter, application services
 *              that call `withMatchLock`, infrastructure adapters.
 * INVARIANTS:
 *   - Type-only import. Domain modules are still free of runtime Prisma deps.
 * RELATED DOCS: docs/ARCHITECTURE.md §8, docs/adr/0003-…
 */
import type { Prisma } from "@prisma/client";

export type TransactionClient = Prisma.TransactionClient;
