/**
 * MODULE: moderation.domain.admin-action-repository
 * PURPOSE: Repository port for the append-only `AdminAction` audit log.
 *          Domain owns the contract; infrastructure provides the Prisma
 *          adapter.
 * LAYER: domain
 * DEPENDENCIES: ./admin-action
 * CONSUMED BY: src/moderation/application/*,
 *              src/moderation/infrastructure/prisma-admin-action-repository.ts
 * INVARIANTS:
 *   - Append-only: there is no update or delete. The trail must survive for
 *     appeals (spec personal.md → "Audit log").
 *   - `record` is called by the ban/unban/promote/demote services AFTER the
 *     primary user-row mutation succeeds — a failed mutation must not leave an
 *     audit row claiming it happened. It is NOT inside an advisory lock (the
 *     User aggregate has none).
 * RELATED DOCS: docs/ARCHITECTURE.md §8 (Persistence), ADR-0003.
 */
import type { RecordAdminActionInput } from "./admin-action";

export interface AdminActionRepository {
  record(input: RecordAdminActionInput): Promise<void>;
}
