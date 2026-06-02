/**
 * Bulk-import venues from a JSON file.
 * Usage: npx tsx prisma/import-venues.ts prisma/venues.json
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
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx prisma/import-venues.ts <path-to-venues.json>");
    process.exit(1);
  }

  const data: VenueInput[] = JSON.parse(
    readFileSync(resolve(filePath), "utf-8")
  );

  console.log(`Importing ${data.length} venues…`);
  const result = await prisma.venue.createMany({ data, skipDuplicates: true });
  console.log(`Done. Inserted: ${result.count}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
