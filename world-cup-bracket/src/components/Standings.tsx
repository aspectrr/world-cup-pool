import { useMemo } from "react";
import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import { PLAYERS, PRIZES } from "../data/players";
import { calcGroupStandings, getAliveTeams, getTeamStage, knockoutWinner } from "../utils/standings";

type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "winner";

const STAGE_ORDER: Stage[] = [
  "group",
  "r32",
  "r16",
  "qf",
  "sf",
  "final",
  "winner",
];

function stagePoints(stage: Stage): number {
  return STAGE_ORDER.indexOf(stage);
}



// When was a player's LAST team eliminated?
// Returns { round, date } — used for first-out tiebreaking by time
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

  // Check knockout losses
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
  totalStagePts: number;
  groupPoints: number; // sum of group-stage points across owned teams
  groupGD: number; // sum of goal differential across owned teams
  bestStage: Stage;
  eliminated: boolean;
  lastElimRound: number; // when last team was KO'd (-1 = still alive or no KO yet)
  lastElimDate: string; // ISO date of last elimination (for timing tiebreaker)
}

export function Standings({
  gMatches,
  kMatches,
}: {
  gMatches: GroupMatch[];
  kMatches: KnockoutMatch[];
}) {
  const alive = useMemo(
    () => getAliveTeams(gMatches, kMatches),
    [gMatches, kMatches],
  );

  const { rankings, championPlayer, runnerUpPlayer, firstOutPlayer } =
    useMemo(() => {
      // Pre-compute group standings once to derive per-player point/GD totals
      const groupMap = calcGroupStandings(gMatches);
      const rowFor = (tIdx: number) =>
        groupMap.get(TEAMS[tIdx].group)?.find((s) => s.teamIdx === tIdx);

      const scores: PlayerScore[] = PLAYERS.map((p) => {
        let totalStagePts = 0;
        let bestStage: Stage = "group";
        let aliveCount = 0;
        let groupPoints = 0;
        let groupGD = 0;

        for (const tIdx of p.teamIndices) {
          const stage = getTeamStage(tIdx, kMatches);
          totalStagePts += stagePoints(stage);
          if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(bestStage)) {
            bestStage = stage;
          }
          if (alive.has(tIdx)) aliveCount++;

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
          totalStagePts,
          groupPoints,
          groupGD,
          bestStage,
          eliminated: aliveCount === 0,
          lastElimRound: elim.round,
          lastElimDate: elim.date,
        };
      });

      // Sort: alive → KO stage pts → group points → group GD → best stage → last elim later
      // Group-stage phase: everyone has alive=6, stagePts=0, so groupPoints + groupGD
      // become the effective ranking. Knockout phase: alive/stagePts take over.
      scores.sort((a, b) => {
        if (b.alive !== a.alive) return b.alive - a.alive;
        if (b.totalStagePts !== a.totalStagePts)
          return b.totalStagePts - a.totalStagePts;
        if (b.groupPoints !== a.groupPoints)
          return b.groupPoints - a.groupPoints;
        if (b.groupGD !== a.groupGD) return b.groupGD - a.groupGD;
        if (
          STAGE_ORDER.indexOf(b.bestStage) !== STAGE_ORDER.indexOf(a.bestStage)
        )
          return (
            STAGE_ORDER.indexOf(b.bestStage) - STAGE_ORDER.indexOf(a.bestStage)
          );
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
          // Same round → compare ISO dates (earlier = eliminated first)
          return (a.lastElimDate || "").localeCompare(b.lastElimDate || "");
        });
        firstOutPlayer = fullyEliminated[0].name;
      }

      return {
        rankings: scores,
        championPlayer,
        runnerUpPlayer,
        firstOutPlayer,
      };
    }, [gMatches, kMatches, alive]);

  // Live preview: until the FINAL is played, project champion/runner-up
  // from the current standings leader (#1 = on pace for champion, #2 =
  // runner-up). Once the final is decided, the real winner/loser overrides.
  const projectedChampion = !championPlayer && rankings[0]?.name;
  const projectedRunnerUp = !runnerUpPlayer && rankings[1]?.name;
  const championDisplay = championPlayer ?? projectedChampion ?? null;
  const runnerUpDisplay = runnerUpPlayer ?? projectedRunnerUp ?? null;

  return (
    <div>
      <div className="prize-legend">
        <div className="prize-item">
          <div className="amount">${PRIZES.winner}</div>
          <div className={`label${championDisplay ? " prize-won" : ""}`}>
            {championDisplay ?? "Winner"}
          </div>
        </div>
        <div className="prize-item">
          <div className="amount">${PRIZES.runnerUp}</div>
          <div className={`label${runnerUpDisplay ? " prize-won" : ""}`}>
            {runnerUpDisplay ?? "Runner-up"}
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
          // Champion/runner-up container treatment is a live preview from
          // current rank until the FINAL is actually played.
          let prizeLabel: string | null = null;
          let cardPrizeClass = "";
          if (p.name === championPlayer) {
            prizeLabel = `🏆 $${PRIZES.winner} — Champion`;
            cardPrizeClass = " prize-champion";
          } else if (p.name === runnerUpPlayer) {
            prizeLabel = `🥈 $${PRIZES.runnerUp} — Runner-up`;
            cardPrizeClass = " prize-runnerup";
          } else if (p.name === projectedChampion) {
            prizeLabel = `📊 $${PRIZES.winner} — Projected Champion`;
            cardPrizeClass = " prize-champion projected";
          } else if (p.name === projectedRunnerUp) {
            prizeLabel = `📊 $${PRIZES.runnerUp} — Projected Runner-up`;
            cardPrizeClass = " prize-runnerup projected";
          }

          // Every eliminated player gets the grayscale ELIMINATED treatment.
          // Only the first-out additionally gets the gold $5 badge.
          if (p.eliminated) {
            cardPrizeClass = " prize-firstout";
            if (p.name === firstOutPlayer) {
              prizeLabel = `💸 $${PRIZES.firstOut} — First Out`;
            } else {
              prizeLabel = `☠️ Eliminated`;
            }
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
                >
                  {p.alive}/6
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
