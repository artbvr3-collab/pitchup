-- CreateTable
CREATE TABLE "venues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "google_maps_url" TEXT,
    "surface" TEXT[],
    "cover_id" VARCHAR(40) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "captain_id" UUID NOT NULL,
    "venue_id" UUID NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "duration" INTEGER NOT NULL,
    "total_spots" SMALLINT NOT NULL,
    "price" INTEGER NOT NULL,
    "surface" TEXT NOT NULL,
    "studs_allowed" BOOLEAN NOT NULL,
    "field_booked" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "description_hidden" BOOLEAN NOT NULL DEFAULT false,
    "captain_crew" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "cancel_reason_hidden" BOOLEAN NOT NULL DEFAULT false,
    "cover_id" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "matches_start_time_idx" ON "matches"("start_time");

-- CreateIndex
CREATE INDEX "matches_venue_id_idx" ON "matches"("venue_id");

-- CreateIndex
CREATE INDEX "matches_captain_id_idx" ON "matches"("captain_id");

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_captain_id_fkey" FOREIGN KEY ("captain_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
