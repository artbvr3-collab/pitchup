/**
 * Replace-import: delete venues that have NO matches, then bulk-insert the new
 * set from prisma/venues.json — atomically, in one transaction. Venues that
 * still have matches are KEPT (deleting them would break the match FK).
 *
 * Usage: npx tsx prisma/import-venues-replace.ts
 * Safety: run prisma/backup-venues-pre-import.json first (the backup script).
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { resolve } from "path";

process.loadEnvFile(".env.local");

const prisma = new PrismaClient();

type VenueInput = {
  name: string;
  address: string;
  lat: number;
  lng: number;
  googleMapsUrl?: string;
  photoUrl?: string | null;
  surface: string[];
  coverId: string;
};

async function main() {
  const data: VenueInput[] = JSON.parse(
    readFileSync(resolve("prisma/venues.json"), "utf-8"),
  );
  console.log(`Loaded ${data.length} new venues from venues.json`);

  const before = await prisma.venue.count();
  const deletable = await prisma.venue.findMany({
    where: { matches: { none: {} } },
    select: { name: true },
  });
  const keep = before - deletable.length;
  console.log(
    `Current: ${before} venues — deleting ${deletable.length} without matches, keeping ${keep} with matches.`,
  );
  console.log("  Deleting:", deletable.map((v) => v.name).join(", "));

  const [del, ins] = await prisma.$transaction([
    prisma.venue.deleteMany({ where: { matches: { none: {} } } }),
    prisma.venue.createMany({ data, skipDuplicates: true }),
  ]);

  const after = await prisma.venue.count();
  console.log(
    `\nDeleted ${del.count}, inserted ${ins.count}. Total now: ${after} (expected ${keep + ins.count}).`,
  );
}

main()
  .catch((e) => {
    console.error("import failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
