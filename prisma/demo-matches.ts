/**
 * Reset demo data: delete all existing matches + the orphan "Football Pitch N"
 * placeholder venues, then create a few fresh demo matches on CENTRAL Prague
 * venues, hosted by the seed Demo Captains. Idempotent-ish: safe to re-run
 * (it deletes all matches each time, then recreates the demo set).
 *
 * Usage: npx tsx prisma/demo-matches.ts
 */
import { PrismaClient } from "@prisma/client";

process.loadEnvFile(".env.local");

const prisma = new PrismaClient();

/** Prague is UTC+2 (CEST) in June → subtract 2 to get the UTC hour. */
function pragueTime(daysAhead: number, hour: number, min = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysAhead);
  d.setUTCHours(hour - 2, min, 0, 0);
  return d;
}

async function main() {
  await prisma.$transaction(async (tx) => {
    // 1) wipe all matches (test data — verified no join requests / likes / chat)
    const delM = await tx.match.deleteMany({});
    console.log(`Deleted ${delM.count} match(es).`);

    // 2) drop the orphan "Football Pitch N" placeholders (now match-less)
    const delV = await tx.venue.deleteMany({
      where: { name: { startsWith: "Football Pitch " }, matches: { none: {} } },
    });
    console.log(`Deleted ${delV.count} placeholder venue(s).`);

    // 3) hosts = seed demo captains
    const captains = await tx.user.findMany({
      where: { name: { startsWith: "[seed] Demo Captain" } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    if (captains.length < 2) throw new Error("Need 2 seed Demo Captains");
    const [alpha, beta] = captains;

    // 4) central venues by name
    async function venueByName(name: string) {
      const v = await tx.venue.findFirst({
        where: { name },
        select: { id: true, coverId: true, surface: true, name: true },
      });
      if (!v) throw new Error(`Venue not found: ${name}`);
      return v;
    }
    const naFrantisku = await venueByName("Sportovní areál Na Františku");
    const zizkov = await venueByName("Stadion FK Viktoria Žižkov");
    const absolute = await venueByName("ABSOLUTE TEAMSPORT SPORTFOTBAL");

    // 5) create demo matches (coverId snapshots the venue's cover)
    const demos = [
      {
        venue: naFrantisku,
        captainId: alpha!.id,
        startTime: pragueTime(1, 18, 0),
        duration: 60,
        totalSpots: 10,
        price: 0,
        surface: "grass",
        studsAllowed: true,
        fieldBooked: true,
        description: "Casual evening kickabout in the centre. All levels welcome.",
      },
      {
        venue: zizkov,
        captainId: beta!.id,
        startTime: pragueTime(2, 19, 30),
        duration: 90,
        totalSpots: 12,
        price: 120,
        surface: "grass",
        studsAllowed: true,
        fieldBooked: true,
        description: "7v7 at Žižkov. Pitch booked, bring light + dark shirt.",
      },
      {
        venue: absolute,
        captainId: alpha!.id,
        startTime: pragueTime(4, 10, 0),
        duration: 60,
        totalSpots: 8,
        price: 150,
        surface: "hard",
        studsAllowed: false,
        fieldBooked: true,
        description: "Weekend indoor 4v4. Turf shoes only, no studs.",
      },
    ];

    for (const d of demos) {
      await tx.match.create({
        data: {
          captainId: d.captainId,
          venueId: d.venue.id,
          startTime: d.startTime,
          duration: d.duration,
          totalSpots: d.totalSpots,
          price: d.price,
          surface: d.surface,
          studsAllowed: d.studsAllowed,
          fieldBooked: d.fieldBooked,
          description: d.description,
          coverId: d.venue.coverId,
        },
      });
      console.log(
        `Created match @ ${d.venue.name} — ${d.startTime.toISOString()} (${d.duration}min, ${d.totalSpots} spots, ${d.price === 0 ? "free" : d.price + " CZK"})`,
      );
    }
  });

  const venues = await prisma.venue.count();
  const matches = await prisma.match.count();
  console.log(`\nNow: ${venues} venues, ${matches} matches.`);
}

main()
  .catch((e) => {
    console.error("failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
