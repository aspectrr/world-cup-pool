import { useMemo } from "react";
import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import { PLAYERS, PRIZES } from "../data/players";
import {
  calcGroupStandings,
  getAliveTeams,
  getTeamStage,
  knockoutWinner,
} from "../utils/standings";

// When was a player's LAST team eliminated?
// Tracks both group stage (3rd/4th = eliminated if not best 3rd) and knockout
// Returns { round, date } — round -1 = group stage, 0+ = knockout round
function getLastElimination(
  teamIndices: number[],
  gMatches: GroupMatch[],
  kMatches: KnockoutMatch[],
): { round: number; date: string } {
  let lastElimRound = -1;
  let lastElimDate = "";

  const update = (roundIdx: number, matchDate: string) => {
    if (
      roundIdx > lastElimRound ||
      (roundIdx === lastElimRound && matchDate > lastElimDate)
    ) {
      lastElimRound = roundIdx;
      lastElimDate = matchDate;
    }
  };

  // Check knockout losses (uses knockoutWinner so pens/ET losses count)
  for (const tIdx of teamIndices) {
    for (const m of kMatches) {
      if (m.homeIdx !== tIdx && m.awayIdx !== tIdx) continue;
      const w = knockoutWinner(m);
      if (w === null) continue;
      if (w === tIdx) continue; // won this match, not eliminated here
      const roundIdx = ["R32", "R16", "QF", "SF", "FINAL"].indexOf(m.round);
      update(roundIdx, m.date ?? "");
    }
  }

  // Check group stage elimination (3rd/4th place)
  // If a team didn't make it to any knockout match, they were eliminated in groups
  // Use the date of their last group match as elimination time
  const teamsInKnockout = new Set<number>();
  for (const m of kMatches) {
    if (m.homeIdx !== null) teamsInKnockout.add(m.homeIdx);
    if (m.awayIdx !== null) teamsInKnockout.add(m.awayIdx);
  }
  const anyKnockoutStarted = kMatches.some((m) => m.homeIdx !== null);

  if (anyKnockoutStarted) {
    for (const tIdx of teamIndices) {
      if (teamsInKnockout.has(tIdx)) continue; // made it to KO, not group-eliminated
      // Find this team's last group match date
      for (const m of gMatches) {
        if (m.homeIdx !== tIdx && m.awayIdx !== tIdx) continue;
        update(-1, m.date ?? ""); // -1 = group stage elimination
      }
    }
  }

  return { round: lastElimRound, date: lastElimDate };
}

interface PlayerScore {
  name: string;
  teamIndices: number[];
  alive: number;
  equity: number; // Σ P(team wins WC) across owned teams (champion equity)
  totalStagePts: number;
  groupPoints: number; // sum of group-stage points across owned teams
  groupGD: number; // sum of goal differential across owned teams
  bestStage: string;
  eliminated: boolean;
  lastElimRound: number; // when last team was KO'd (-1 = still alive or no KO yet)
  lastElimDate: string; // ISO date of last elimination (for timing tiebreaker)
}

export function Standings({
  gMatches,
  kMatches,
  winnerProbs = {},
}: {
  gMatches: GroupMatch[];
  kMatches: KnockoutMatch[];
  winnerProbs?: Record<number, number>;
}) {
  const alive = useMemo(
    () => getAliveTeams(gMatches, kMatches),
    [gMatches, kMatches],
  );

  const { rankings, hasWinnerData, championPlayer, runnerUpPlayer, firstOutPlayer } =
    useMemo(() => {
      // Pre-compute group standings once to derive per-player point/GD totals
      const groupMap = calcGroupStandings(gMatches);
      const rowFor = (tIdx: number) =>
        groupMap.get(TEAMS[tIdx].group)?.find((s) => s.teamIdx === tIdx);

      const scores: PlayerScore[] = PLAYERS.map((p) => {
        let totalStagePts = 0;
        let bestStage: string = "group";
        let aliveCount = 0;
        let groupPoints = 0;
        let groupGD = 0;
        let equity = 0;

        for (const tIdx of p.teamIndices) {
          const stage = getTeamStage(tIdx, kMatches);
          totalStagePts += ["group", "r32", "r16", "qf", "sf", "final", "winner"].indexOf(stage);
          if (["group", "r32", "r16", "qf", "sf", "final", "winner"].indexOf(stage) >
            ["group", "r32", "r16", "qf", "sf", "final", "winner"].indexOf(bestStage)) {
            bestStage = stage;
          }
          if (alive.has(tIdx)) aliveCount++;
          // Teams eliminated can't win — skip their (stale) market prob.
          if (alive.has(tIdx)) equity += winnerProbs[tIdx] ?? 0;

          const row = rowFor(tIdx);
          if (row) {
            groupPoints += row.points;
            groupGD += row.gf - row.ga;
          }
        }

        const elim = getLastElimination(p.teamIndices, gMatches, kMatches);

        return {
          name: p.name,
          teamIndices: p.teamIndices,
          alive: aliveCount,
          equity,
          totalStagePts,
          groupPoints,
          groupGD,
          bestStage,
          eliminated: aliveCount === 0,
          lastElimRound: elim.round,
          lastElimDate: elim.date,
        };
      });

      const STAGE_ORDER = ["group", "r32", "r16", "qf", "sf", "final", "winner"];

      // Sort: champion equity → alive → KO stage pts → group points → group GD → best stage
      scores.sort((a, b) => {
        if (b.equity !== a.equity) return b.equity - a.equity;
        if (b.alive !== a.alive) return b.alive - a.alive;
        if (b.totalStagePts !== a.totalStagePts)
          return b.totalStagePts - a.totalStagePts;
        if (b.groupPoints !== a.groupPoints)
          return b.groupPoints - a.groupPoints;
        if (b.groupGD !== a.groupGD) return b.groupGD - a.groupGD;
        if (STAGE_ORDER.indexOf(b.bestStage) !== STAGE_ORDER.indexOf(a.bestStage))
          return STAGE_ORDER.indexOf(b.bestStage) - STAGE_ORDER.indexOf(a.bestStage);
        return b.lastElimRound - a.lastElimRound;
      });

      // Prize winners
      let championPlayer: string | null = null;
      let runnerUpPlayer: string | null = null;
      let firstOutPlayer: string | null = null;

      // Champion = player who owns the WC winner (team that won the FINAL).
      // Uses knockoutWinner so penalty-shootout wins (tied score) count.
      const finalMatch = kMatches.find((m) => m.round === "FINAL" && m.played);
      if (finalMatch) {
        const winnerIdx = knockoutWinner(finalMatch);
        if (winnerIdx !== null) {
          const loserIdx =
            winnerIdx === finalMatch.homeIdx
              ? finalMatch.awayIdx
              : finalMatch.homeIdx;
          for (const p of PLAYERS) {
            if (p.teamIndices.includes(winnerIdx)) championPlayer = p.name;
          }
          if (loserIdx !== null) {
            for (const p of PLAYERS) {
              if (p.teamIndices.includes(loserIdx)) runnerUpPlayer = p.name;
            }
          }
        }
      }

      // First Out = first player to have ALL 6 teams eliminated
      // Tiebreaker: earliest round → earliest date/time of last elimination
      const fullyEliminated = scores.filter((s) => s.eliminated);
      if (fullyEliminated.length > 0) {
        fullyEliminated.sort((a, b) => {
          if (a.lastElimRound !== b.lastElimRound)
            return a.lastElimRound - b.lastElimRound;
          return (a.lastElimDate || "").localeCompare(b.lastElimDate || "");
        });
        firstOutPlayer = fullyEliminated[0].name;
      }

      return {
        rankings: scores,
        hasWinnerData: scores.some((s) => s.equity > 0),
        championPlayer,
        runnerUpPlayer,
        firstOutPlayer,
      };
    }, [gMatches, kMatches, alive, winnerProbs]);

  // Live preview until finalized: project champion/runner-up from current
  // standings leader (#1/#2), project first-out from current last place.
  // The top legend only shows a name once finalized.
  const projectedChampion = !championPlayer ? rankings[0]?.name : null;
  const projectedRunnerUp = !runnerUpPlayer ? rankings[1]?.name : null;
  const projectedFirstOut = !firstOutPlayer
    ? rankings[rankings.length - 1]?.name
    : null;

  return (
    <div>
      <div className="prize-legend">
        <div className="prize-item">
          <div className="amount">${PRIZES.winner}</div>
          <div className={`label${championPlayer ? " prize-won" : ""}`}>
            {championPlayer ?? "Winner"}
          </div>
        </div>
        <div className="prize-item">
          <div className="amount">${PRIZES.runnerUp}</div>
          <div className={`label${runnerUpPlayer ? " prize-won" : ""}`}>
            {runnerUpPlayer ?? "Runner-up"}
          </div>
        </div>
        <div className="prize-item">
          <div className="amount">${PRIZES.firstOut}</div>
          <div className={`label${firstOutPlayer ? " prize-won" : ""}`}>
            {firstOutPlayer ?? "First Out"}
          </div>
        </div>
      </div>

      <div className="standings-list">
        {rankings.map((p, i) => {
          const rankClass =
            i === 0 ? "gold" : i === 1 ? "silver" : i === 2 ? "bronze" : "";

          // Determine prize label + container class for this player.
          // Real winner/loser/first-out: solid border + text badge.
          // Projected (current pace): dashed border only, no text label.
          let prizeLabel: string | null = null;
          let cardPrizeClass = "";
          if (p.name === championPlayer) {
            prizeLabel = `🏆 $${PRIZES.winner} — Champion`;
            cardPrizeClass = " prize-champion";
          } else if (p.name === runnerUpPlayer) {
            prizeLabel = `🥈 $${PRIZES.runnerUp} — Runner-up`;
            cardPrizeClass = " prize-runnerup";
          } else if (p.name === projectedChampion) {
            cardPrizeClass = " prize-champion projected";
          } else if (p.name === projectedRunnerUp) {
            cardPrizeClass = " prize-runnerup projected";
          }

          // First-out: real (someone fully eliminated) gets gold badge +
          // grayscale; projected (just last place right now) gets red tint.
          // Every other fully-eliminated player also gets grayscale + stamp.
          if (p.name === firstOutPlayer) {
            prizeLabel = `💸 $${PRIZES.firstOut} — First Out`;
            cardPrizeClass = " prize-firstout";
          } else if (p.name === projectedFirstOut) {
            cardPrizeClass = " prize-firstout projected";
          } else if (p.eliminated) {
            cardPrizeClass = " prize-firstout";
            prizeLabel = `☠️ Eliminated`;
          }

          return (
            <div key={p.name} className={`standing-card${cardPrizeClass}`}>
              <div className={`standing-rank ${rankClass}`}>{i + 1}</div>
              <div className="standing-info">
                <div className="standing-name">{p.name}</div>
                <div className="standing-teams">
                  {p.teamIndices.map((tIdx) => {
                    const team = TEAMS[tIdx];
                    const isAlive = alive.has(tIdx);
                    return (
                      <span
                        key={tIdx}
                        className={`standing-chip${isAlive ? "" : " eliminated"}`}
                      >
                        <img src={flagUrl(team.code)} alt={team.code} />
                        {shortName(team.name, 11)}
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="standing-stats">
                <div
                  className={`standing-alive${p.alive === 0 ? " none" : ""}`}
                  title={
                    hasWinnerData
                      ? "Champion equity: Σ P(team wins WC)"
                      : "Teams still alive"
                  }
                >
                  {hasWinnerData
                    ? `${(p.equity * 100).toFixed(1)}%`
                    : `${p.alive}/6`}
                </div>
                <div className="standing-record">
                  {p.eliminated
                    ? `ELIMINATED ${p.bestStage.toUpperCase()} STAGE`
                    : `ALIVE`}
                </div>
                {prizeLabel && (
                  <div className="standing-prize">{prizeLabel}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
