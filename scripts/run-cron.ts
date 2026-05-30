/**
 * MODULE: scripts.run-cron
 * PURPOSE: Manual CLI runner for the Layer 7b crons. Invokes the same wired
 *          application services that the future Layer 10 host-side cron
 *          (Caddy/VPS) will call. Useful for:
 *            - One-shot smoke tests against the dev Neon DB (`pnpm tsx
 *              scripts/run-cron.ts inbox-ttl`).
 *            - Dry runs at DST boundaries via `--now=ISO` (the services
 *              accept `now` as a method param — no wall-clock reads).
 *            - Manual replay after a host-cron miss.
 *          NOT used as the production scheduler — that's Layer 10. This
 *          script is purely a developer tool.
 *
 * USAGE:
 *   pnpm tsx scripts/run-cron.ts <command> [--now=ISO]
 *
 *   Commands:
 *     morning-today      — cron #1 (10:00 Prague: matches today, start_time >= now)
 *     morning-tomorrow   — cron #2 (20:00 Prague: matches tomorrow 00:00–12:00 Prague)
 *     auto-reject        — cron #3 (every 5 min: pending past start_time → rejected)
 *     inbox-ttl          — cron #4 (03:00 Prague: 30d notification / 7d reminder_sent / 1d watch)
 *
 *   --now=ISO            — override the wall-clock `now` (e.g. for DST dry runs).
 *                          Default: new Date().
 *
 * EXAMPLES:
 *   pnpm tsx scripts/run-cron.ts inbox-ttl
 *   pnpm tsx scripts/run-cron.ts morning-today --now=2026-03-29T08:00:00Z
 *   pnpm tsx scripts/run-cron.ts auto-reject
 *
 * EXIT CODES: 0 on success, 1 on any thrown error (printed to stderr).
 *
 * RELATED DOCS: docs/spec/pitchup-spec-match.md → "Cron jobs"
 */
// Load DATABASE_URL etc. from .env.local using Node 22+ built-in. Must run
// BEFORE any module that touches Prisma (which reads env at import time).
process.loadEnvFile(".env.local");

import { autoRejectPendingService } from "@/src/match_lifecycle/composition";
import {
  inboxTtlService,
  morningReminderService,
} from "@/src/notifications/composition";
import { prisma } from "@/src/shared/db/prisma";

type Command =
  | "morning-today"
  | "morning-tomorrow"
  | "auto-reject"
  | "inbox-ttl";

const COMMANDS: readonly Command[] = [
  "morning-today",
  "morning-tomorrow",
  "auto-reject",
  "inbox-ttl",
];

interface ParsedArgs {
  readonly command: Command;
  readonly now: Date;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flags = new Map<string, string>(
    argv
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const [k, ...rest] = a.slice(2).split("=");
        return [k!, rest.join("=") || "true"];
      }),
  );

  const cmdRaw = positional[0];
  if (!cmdRaw || !(COMMANDS as readonly string[]).includes(cmdRaw)) {
    throw new Error(
      `Unknown or missing command. Expected one of: ${COMMANDS.join(", ")}`,
    );
  }
  const command = cmdRaw as Command;

  const nowFlag = flags.get("now");
  const now = nowFlag ? new Date(nowFlag) : new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error(`--now: invalid ISO timestamp "${nowFlag}"`);
  }

  return { command, now };
}

async function run(command: Command, now: Date): Promise<unknown> {
  switch (command) {
    case "morning-today":
      return morningReminderService.run({ now, window: "today" });
    case "morning-tomorrow":
      return morningReminderService.run({ now, window: "tomorrow" });
    case "auto-reject":
      return autoRejectPendingService.run(now);
    case "inbox-ttl":
      return inboxTtlService.run(now);
  }
}

async function main(): Promise<void> {
  const { command, now } = parseArgs(process.argv.slice(2));
  process.stderr.write(
    `[run-cron] command=${command} now=${now.toISOString()}\n`,
  );

  try {
    const result = await run(command, now);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(
    `[run-cron] FAILED: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
  );
  process.exitCode = 1;
});
