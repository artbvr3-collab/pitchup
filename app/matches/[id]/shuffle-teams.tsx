/**
 * MODULE: app.matches.id.shuffle-teams
 * PURPOSE: Captain-only "Shuffle teams" tool (Layer 6.X) — the [🎲 Shuffle
 *          teams] button in the top-right of Tab Lineup + its bottom-sheet.
 *          Frontend-only, ephemeral: randomises the roster into 2/3 teams and
 *          caches the last result in localStorage per match. No DB, no push,
 *          not reactive (spec match.md "Shuffle teams").
 * LAYER: interfaces (client)
 * DEPENDENCIES: src/ui/components/sheet, src/ui/components/toast,
 *               src/ui/lib/team-shuffle
 * CONSUMED BY: app/matches/[id]/lineup-tab.tsx (captain only)
 * INVARIANTS:
 *   - Rendered only for the captain on a non-Cancelled match (the parent
 *     gates this; the button itself assumes it should show).
 *   - Two sheet steps: Setup (radio 2/3 + [Shuffle], disabled when
 *     filled < 2*teamCount with a "Need at least N players" tooltip) and
 *     Result (Red/Blue/[Green] columns + Shuffle again / Copy as text /
 *     Change setup / Done).
 *   - On open: if a cached result exists for this match, jump straight to
 *     Result (spec §346). Otherwise start on Setup.
 *   - Units come from the live roster snapshot passed in (`computeSlots`
 *     filled): captain + accepted + their guests + crew stubs. Guests are
 *     independent units (spec §340). NOT reactive — the captain re-shuffles
 *     to pick up roster changes.
 * RELATED DOCS:
 *   - docs/spec/pitchup-spec-match.md → "Shuffle teams"
 */
"use client";

import { useMemo, useState } from "react";

import type { MatchStateLineup } from "@/src/match_lifecycle/application/dto/match-state";
import { Sheet } from "@/src/ui/components/sheet";
import { useToast } from "@/src/ui/components/toast";
import {
  buildShuffleUnits,
  formatTeamsAsText,
  groupByTeam,
  readTeamCache,
  shuffleIntoTeams,
  writeTeamCache,
  type ShuffleRosterInput,
  type TeamCount,
  type TeamShuffleResult,
} from "@/src/ui/lib/team-shuffle";

export interface ShuffleTeamsProps {
  readonly matchId: string;
  readonly lineup: MatchStateLineup;
  readonly crew: readonly string[];
}

type Step = "setup" | "result";

export function ShuffleTeams(props: ShuffleTeamsProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("setup");
  const [teamCount, setTeamCount] = useState<TeamCount>(2);
  const [result, setResult] = useState<TeamShuffleResult | null>(null);

  const roster = useMemo<ShuffleRosterInput>(
    () => ({
      captainName: props.lineup.captain.name,
      accepted: props.lineup.accepted.map((p) => ({
        name: p.user.banned ? "Player" : p.user.name,
        guestCount: p.guest_count,
      })),
      crew: [...props.crew],
    }),
    [props.lineup, props.crew],
  );

  const filled = useMemo(() => buildShuffleUnits(roster).length, [roster]);

  const onOpen = () => {
    const cached = readTeamCache(props.matchId);
    if (cached) {
      setTeamCount(cached.teamCount);
      setResult(cached);
      setStep("result");
    } else {
      setStep("setup");
      setResult(null);
    }
    setOpen(true);
  };

  const runShuffle = (count: TeamCount) => {
    const units = buildShuffleUnits(roster);
    const assignments = shuffleIntoTeams(units, count);
    const next: TeamShuffleResult = {
      teamCount: count,
      assignments,
      generatedAt: new Date().toISOString(),
    };
    setResult(next);
    setTeamCount(count);
    setStep("result");
    writeTeamCache(props.matchId, next);
  };

  const copyAsText = async () => {
    if (!result) return;
    const text = formatTeamsAsText(result.assignments, result.teamCount);
    try {
      await navigator.clipboard.writeText(text);
      toast("Teams copied", "success");
    } catch {
      toast("Couldn't copy. Select and copy manually.", "error");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-full border border-border-strong bg-bg-card px-3 py-1 text-[12px] font-semibold text-text-primary hover:bg-bg-card-dim"
      >
        🎲 Shuffle teams
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} ariaLabel="Shuffle teams">
        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          <h2 className="text-[17px] font-bold text-text-primary">
            Shuffle teams
          </h2>

          {step === "setup" ? (
            <SetupView
              teamCount={teamCount}
              filled={filled}
              onTeamCount={setTeamCount}
              onShuffle={() => runShuffle(teamCount)}
            />
          ) : result ? (
            <ResultView
              result={result}
              onShuffleAgain={() => runShuffle(result.teamCount)}
              onCopy={copyAsText}
              onChangeSetup={() => setStep("setup")}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </div>
      </Sheet>
    </>
  );
}

function SetupView({
  teamCount,
  filled,
  onTeamCount,
  onShuffle,
}: {
  teamCount: TeamCount;
  filled: number;
  onTeamCount: (c: TeamCount) => void;
  onShuffle: () => void;
}) {
  const minNeeded = 2 * teamCount;
  const disabled = filled < minNeeded;

  return (
    <>
      <fieldset className="flex flex-col gap-2">
        {([2, 3] as const).map((count) => (
          <label
            key={count}
            className="flex cursor-pointer items-center gap-3 rounded-card border border-border-soft bg-bg-card px-3 py-2.5"
          >
            <input
              type="radio"
              name="teamCount"
              checked={teamCount === count}
              onChange={() => onTeamCount(count)}
              className="h-4 w-4 accent-green-dark"
            />
            <span className="text-[14px] font-medium text-text-primary">
              {count} teams
            </span>
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        onClick={onShuffle}
        disabled={disabled}
        title={disabled ? `Need at least ${minNeeded} players` : undefined}
        className="h-12 rounded-btn bg-lime text-[15px] font-semibold text-lime-text shadow-btn-lime hover:bg-lime-dark disabled:cursor-not-allowed disabled:opacity-50"
      >
        Shuffle
      </button>
      {disabled && (
        <p className="text-center text-[12px] text-text-muted">
          Need at least {minNeeded} players
        </p>
      )}
    </>
  );
}

function ResultView({
  result,
  onShuffleAgain,
  onCopy,
  onChangeSetup,
  onDone,
}: {
  result: TeamShuffleResult;
  onShuffleAgain: () => void;
  onCopy: () => void;
  onChangeSetup: () => void;
  onDone: () => void;
}) {
  const groups = groupByTeam(result.assignments, result.teamCount);

  return (
    <>
      <div className="flex flex-col gap-3">
        {groups.map((group) => (
          <div
            key={group.meta.index}
            className="rounded-card border border-border-soft bg-bg-card p-3"
          >
            <h3 className="mb-1.5 text-[14px] font-bold text-text-primary">
              {group.meta.emoji} {group.meta.label} ({group.members.length})
            </h3>
            <ul className="flex flex-col gap-0.5">
              {group.members.map((m, i) => (
                <li key={`${m}-${i}`} className="text-[13px] text-text-secondary">
                  {m}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onShuffleAgain}
          className="h-11 rounded-btn bg-green-dark text-[14px] font-semibold text-text-inverted hover:bg-green-mid"
        >
          🎲 Shuffle again
        </button>
        <button
          type="button"
          onClick={onCopy}
          className="h-11 rounded-btn border border-border-strong bg-bg-card text-[14px] font-semibold text-text-primary hover:bg-bg-card-dim"
        >
          Copy as text
        </button>
        <button
          type="button"
          onClick={onChangeSetup}
          className="h-11 rounded-btn border border-border-strong bg-bg-card text-[14px] font-semibold text-text-primary hover:bg-bg-card-dim"
        >
          Change setup
        </button>
        <button
          type="button"
          onClick={onDone}
          className="h-11 rounded-btn bg-bg-card-dim text-[14px] font-semibold text-text-primary hover:bg-bg-card"
        >
          Done
        </button>
      </div>
    </>
  );
}
