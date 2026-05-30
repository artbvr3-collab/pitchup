/**
 * MODULE: match_lifecycle.domain.admin-match-deletion-repository
 * PURPOSE: Port for the `admin_match_deletions` tombstone table (Layer 9c).
 *          Stores affected user IDs after a hard admin match delete so the
 *          global poll can emit { action: 'admin_deleted' } for ≤24 h.
 * LAYER: domain
 * DEPENDENCIES: none (pure port)
 * CONSUMED BY: match_lifecycle/application/admin-delete-match-service.ts,
 *              notifications/application/updates-state-service.ts,
 *              notifications/application/inbox-ttl-service.ts
 * INVARIANTS:
 *   - `record()` is called BEFORE the match is deleted so affected user IDs
 *     can be read from existing JoinRequest / Watch rows.
 *   - `findForUserSince()` is called by the global poll to emit admin_deleted
 *     entries. Returns match_id strings (the match no longer exists as a row).
 *   - `deleteOlderThan()` is called by InboxTtlService (24 h TTL).
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-personal.md → "/admin/matches" → Delete
 *   - docs/spec/pitchup-spec-global.md → "Polling sync" → action: admin_deleted
 */

export interface AdminMatchDeletionRepository {
  /**
   * Persist one tombstone row before the physical match DELETE.
   * `affectedUserIds` = captain + accepted + pending + watching user IDs.
   */
  record(matchId: string, affectedUserIds: readonly string[]): Promise<void>;

  /**
   * Return match_id strings of matches deleted after `since` where
   * `userId` is in `affected_user_ids`. Used by the global poll to prepend
   * `admin_deleted` entries before the `deriveMatchChange` scan.
   */
  findForUserSince(userId: string, since: Date): Promise<readonly string[]>;

  /** TTL cleanup — remove rows older than `before`. */
  deleteOlderThan(before: Date): Promise<number>;
}
