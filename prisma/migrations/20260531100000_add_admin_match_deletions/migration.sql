-- Layer 9c: ephemeral tombstone table for admin hard-deleted matches.
-- After a match is physically deleted all JoinRequest / Watch rows cascade,
-- so UpdatesStateService can no longer derive the viewer's relationship.
-- This table records which users were affected (captain + accepted + pending +
-- watching) so the global poll can emit { action: 'admin_deleted' } for up to
-- 24h after deletion (cleaned by InboxTtlService).
--
-- `match_id` is stored as TEXT (no FK — the match no longer exists).
-- `affected_user_ids` is a UUID array — indexed via GIN for ANY() queries.

CREATE TABLE IF NOT EXISTS "admin_match_deletions" (
  "id"                  UUID        NOT NULL DEFAULT gen_random_uuid(),
  "match_id"            TEXT        NOT NULL,
  "deleted_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  "affected_user_ids"   UUID[]      NOT NULL DEFAULT '{}',

  CONSTRAINT "admin_match_deletions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_match_deletions_deleted_at_idx"
  ON "admin_match_deletions" ("deleted_at");

CREATE INDEX "admin_match_deletions_affected_gin_idx"
  ON "admin_match_deletions" USING GIN ("affected_user_ids");
