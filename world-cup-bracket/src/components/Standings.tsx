import { useMemo } from "react";
import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import { PLAYERS, PRIZES } from "../data/players";
import { getAliveTeams } from "../utils/standings";

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

// Determine how far a team got based on knockout results
function getTeamStage(teamIdx: number, kMatches: KnockoutMatch[]): Stage {
	let furthest: Stage = "group";

	for (const m of kMatches) {
		if (!m.played || m.homeScore === null || m.awayScore === null) continue;
		if (m.homeIdx !== teamIdx && m.awayIdx !== teamIdx) continue;

		const won =
			(m.homeIdx === teamIdx && m.homeScore > m.awayScore) ||
			(m.awayIdx === teamIdx && m.awayScore > m.homeScore);

		const stageMap: Record<string, Stage> = {
			R32: "r32",
			R16: "r16",
			QF: "qf",
			SF: "sf",
			FINAL: "winner",
		};

		if (won) {
			const s = stageMap[m.round] ?? "group";
			if (STAGE_ORDER.indexOf(s) > STAGE_ORDER.indexOf(furthest)) furthest = s;
		} else {
			// Lost = eliminated at this round, stage is one below
			const elimMap: Record<string, Stage> = {
				R32: "group",
				R16: "r32",
				QF: "r16",
				SF: "qf",
				FINAL: "sf",
			};
			const s = elimMap[m.round] ?? "group";
			if (STAGE_ORDER.indexOf(s) > STAGE_ORDER.indexOf(furthest)) furthest = s;
		}
	}

	return furthest;
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
			if (!m.played || m.homeScore === null || m.awayScore === null) continue;
			if (m.homeIdx !== tIdx && m.awayIdx !== tIdx) continue;
			const lost =
				(m.homeIdx === tIdx && m.homeScore < m.awayScore) ||
				(m.awayIdx === tIdx && m.awayScore < m.homeScore);
			if (lost) {
				const roundIdx = ["R32", "R16", "QF", "SF", "FINAL"].indexOf(m.round);
				update(roundIdx, m.date ?? "");
			}
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
	const { rankings, championPlayer, runnerUpPlayer, firstOutPlayer } =
		useMemo(() => {
			const alive = getAliveTeams(gMatches, kMatches);

			const scores: PlayerScore[] = PLAYERS.map((p) => {
				let totalStagePts = 0;
				let bestStage: Stage = "group";
				let aliveCount = 0;

				for (const tIdx of p.teamIndices) {
					const stage = getTeamStage(tIdx, kMatches);
					totalStagePts += stagePoints(stage);
					if (STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(bestStage)) {
						bestStage = stage;
					}
					if (alive.has(tIdx)) aliveCount++;
				}

				const elim = getLastElimination(p.teamIndices, gMatches, kMatches);

				return {
					name: p.name,
					teamIndices: p.teamIndices,
					alive: aliveCount,
					totalStagePts,
					bestStage,
					eliminated: aliveCount === 0,
					lastElimRound: elim.round,
					lastElimDate: elim.date,
				};
			});

			// Sort: most alive → most stage points → best stage → last elim later
			scores.sort((a, b) => {
				if (b.alive !== a.alive) return b.alive - a.alive;
				if (b.totalStagePts !== a.totalStagePts)
					return b.totalStagePts - a.totalStagePts;
				if (
					STAGE_ORDER.indexOf(b.bestStage) !== STAGE_ORDER.indexOf(a.bestStage)
				)
					return (
						STAGE_ORDER.indexOf(b.bestStage) - STAGE_ORDER.indexOf(a.bestStage)
					);
				// If both fully eliminated, who lasted longer?
				return b.lastElimRound - a.lastElimRound;
			});

			// Prize winners
			let championPlayer: string | null = null;
			let runnerUpPlayer: string | null = null;
			let firstOutPlayer: string | null = null;

			// Champion = player who owns the WC winner (team that won the FINAL)
			const finalMatch = kMatches.find((m) => m.round === "FINAL" && m.played);
			if (
				finalMatch &&
				finalMatch.homeScore !== null &&
				finalMatch.awayScore !== null
			) {
				const winnerIdx =
					finalMatch.homeScore > finalMatch.awayScore
						? finalMatch.homeIdx
						: finalMatch.awayIdx;
				const loserIdx =
					finalMatch.homeScore > finalMatch.awayScore
						? finalMatch.awayIdx
						: finalMatch.homeIdx;

				if (winnerIdx !== null) {
					for (const p of PLAYERS) {
						if (p.teamIndices.includes(winnerIdx)) championPlayer = p.name;
					}
				}
				if (loserIdx !== null) {
					for (const p of PLAYERS) {
						if (p.teamIndices.includes(loserIdx)) runnerUpPlayer = p.name;
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
		}, [gMatches, kMatches]);

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

					// Determine prize label for this player
					let prizeLabel: string | null = null;
					if (p.name === championPlayer)
						prizeLabel = `🏆 $${PRIZES.winner} — Champion`;
					else if (p.name === runnerUpPlayer)
						prizeLabel = `🥈 $${PRIZES.runnerUp} — Runner-up`;
					else if (p.name === firstOutPlayer)
						prizeLabel = `💸 $${PRIZES.firstOut} — First Out`;

					return (
						<div key={p.name} className="standing-card">
							<div className={`standing-rank ${rankClass}`}>{i + 1}</div>
							<div className="standing-info">
								<div className="standing-name">{p.name}</div>
								<div className="standing-teams">
									{p.teamIndices.map((tIdx) => {
										const team = TEAMS[tIdx];
										const isAlive =
											!p.eliminated ||
											getAliveTeams(gMatches, kMatches).has(tIdx);
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
										: `${p.alive}/6 alive`}
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
