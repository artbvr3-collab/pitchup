/**
 * Track-B morning smoke test: seeds minimal data → runs morning-today cron
 * → cleans up. Writes to dev-Neon only (no Resend key needed).
 *
 * Run with:
 *   node --env-file=.env.local --import tsx scripts/seed-morning-cron.ts
 */
process.loadEnvFile(".env.local");

import { prisma } from "@/src/shared/db/prisma";
import { morningReminderService } from "@/src/notifications/composition";

const SEED_GOOGLE_SUB = "smoke-test-morning-9f3a";
const SEED_EMAIL = "smoke@example.test";
// start_time: 1 hour from now so it falls inside the "today" window
const startTime = new Date(Date.now() + 60 * 60 * 1000);

async function seed(): Promise<{ userId: string; matchId: string }> {
  // Reuse any existing venue — we just need a valid FK.
  const venue = await prisma.venue.findFirst();
  if (!venue) throw new Error("No venue in DB — cannot seed test match.");

  // Upsert a throwaway user (idempotent on google_sub).
  const user = await prisma.user.upsert({
    where: { googleSub: SEED_GOOGLE_SUB },
    create: {
      googleSub: SEED_GOOGLE_SUB,
      email: SEED_EMAIL,
      name: "Smoke Test Captain",
      avatarUrl: "https://example.test/avatar.png",
      emailNotifications: true,
    },
    update: { deletedAt: null, banned: false, emailNotifications: true },
  });

  const match = await prisma.match.create({
    data: {
      captainId: user.id,
      venueId: venue.id,
      startTime,
      duration: 60,
      totalSpots: 10,
      price: 0,
      surface: "grass",
      studsAllowed: true,
      coverId: "smoke-test-cover-00000000",
    },
  });

  console.log(`[seed] user=${user.id} match=${match.id} startTime=${startTime.toISOString()}`);
  return { userId: user.id, matchId: match.id };
}

async function cleanup(userId: string, matchId: string) {
  // Cascade: notifications + reminder_sent + join_requests are deleted with the match.
  await prisma.match.delete({ where: { id: matchId } });
  await prisma.user.delete({ where: { id: userId } });
  console.log("[cleanup] match + user deleted.");
}

async function main() {
  const { userId, matchId } = await seed();
  try {
    const now = new Date();
    process.stderr.write(`[run-cron] command=morning-today now=${now.toISOString()}\n`);
    const result = await morningReminderService.run({ now, window: "today" });
    console.log("[cron result]", JSON.stringify(result, null, 2));
  } finally {
    await cleanup(userId, matchId);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(`[seed-morning-cron] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exitCode = 1;
});
