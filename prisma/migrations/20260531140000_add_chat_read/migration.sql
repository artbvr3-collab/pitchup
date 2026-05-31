-- CreateTable
CREATE TABLE "chat_reads" (
    "match_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("match_id", "user_id")
);

-- CreateIndex
CREATE INDEX "chat_reads_user_id_idx" ON "chat_reads"("user_id");

-- AddForeignKey
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_match_id_fkey" FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
