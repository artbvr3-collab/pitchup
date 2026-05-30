-- CreateTable
CREATE TABLE "reminder_sent" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_sent_pkey" PRIMARY KEY ("match_id", "user_id", "kind")
);

-- AddForeignKey
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_sent" ADD CONSTRAINT "reminder_sent_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
