-- DropIndex
DROP INDEX "admin_match_deletions_affected_gin_idx";

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "photo_url" TEXT;
