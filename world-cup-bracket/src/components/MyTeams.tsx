import { useState, useMemo } from "react";
import type { GroupMatch, KnockoutMatch, GroupStanding } from "../types";
import { TEAMS, GROUPS, flagUrl, shortName } from "../data/teams";
import { PLAYERS } from "../data/players";
import {
	calcGroupStandings,
	getAliveTeams,
	getTeamStage,
	getGroupAdvancementStatus,
	type AdvancementStatus,
} from "../utils/standings";

/** Always returns all teams per group with zeroes, filling in played stats */
function alwaysStandings(gMatches: GroupMatch[]): Map<string, GroupStanding[]> {
	const computed = calcGroupStandings(gMatches);
	const result = new Map<string, GroupStanding[]>();

	for (const group of GROUPS) {
		const teams = TEAMS.map((t, i) => ({ ...t, idx: i }))
			.filter((t) => t.group === group)
			.sort((a, b) => a.groupPos - b.groupPos);

		const computedGroup = computed.get(group) ?? [];
		const filled = teams.map((t) => {
			const found = computedGroup.find((s) => s.teamIdx === t.idx);
			return (
				found ?? {
					teamIdx: t.idx,
					played: 0,
					won: 0,
					drawn: 0,
					lost: 0,
					gf: 0,
					ga: 0,
					points: 0,
				}
			);
		});

		// Rank by current group performance (points, GD, GF),
		// tie-break by preset groupPos for determinism before games are played.
		filled.sort((a, b) => {
			if (b.points !== a.points) return b.points - a.points;
			const gdA = a.gf - a.ga;
			const gdB = b.gf - b.ga;
			if (gdB !== gdA) return gdB - gdA;
			if (b.gf !== a.gf) return b.gf - a.gf;
			const posA = TEAMS[a.teamIdx].groupPos;
			const posB = TEAMS[b.teamIdx].groupPos;
			return posA - posB;
		});
		result.set(group, filled);
	}
	return result;
}

export function MyTeams({
	gMatches,
	kMatches,
}: {
	gMatches: GroupMatch[];
	kMatches: KnockoutMatch[];
}) {
	const [selectedPlayer, setSelectedPlayer] = useState(() => {
		const saved = Number(localStorage.getItem("myteams:selectedPlayer"));
		return Number.isInteger(saved) && saved >= 0 && saved < PLAYERS.length
			? saved
			: 0;
	});
	const selectPlayer = (i: number) => {
		setSelectedPlayer(i);
		localStorage.setItem("myteams:selectedPlayer", String(i));
	};
	const player = PLAYERS[selectedPlayer];
	const alive = useMemo(
		() => getAliveTeams(gMatches, kMatches),
		[gMatches, kMatches],
	);
	const standings = useMemo(() => alwaysStandings(gMatches), [gMatches]);

	const aliveCount = player.teamIndices.filter((t) => alive.has(t)).length;

	return (
		<div>
			<div className="section-title">My Teams</div>

			<div className="player-selector">
				{PLAYERS.map((p, i) => {
					const pAlive = p.teamIndices.filter((t) => alive.has(t)).length;
					return (
						<button
							key={p.name}
							className={`player-pill${i === selectedPlayer ? " active" : ""}`}
							onClick={() => selectPlayer(i)}
						>
							{p.name}
							<span className="pill-alive">{pAlive}/6</span>
						</button>
					);
				})}
			</div>

			<div className="my-teams-summary">
				<div className="summary-stat">
					<span className="summary-val">{aliveCount}</span>
					<span className="summary-label">Alive</span>
				</div>
				<div className="summary-stat">
					<span className="summary-val">{6 - aliveCount}</span>
					<span className="summary-label">Out</span>
				</div>
			</div>

			<div className="my-teams-grid">
				{player.teamIndices.map((tIdx) => {
					const team = TEAMS[tIdx];
					const isAlive = alive.has(tIdx);
					const stage = getTeamStage(tIdx, kMatches);

					const teamGroupMatches = gMatches.filter(
						(m) => m.homeIdx === tIdx || m.awayIdx === tIdx,
					);

					const groupStandings = standings.get(team.group) ?? [];
					const pos = groupStandings.findIndex((s) => s.teamIdx === tIdx) + 1;
					const standing = groupStandings.find((s) => s.teamIdx === tIdx) ?? {
						teamIdx: tIdx,
						played: 0,
						won: 0,
						drawn: 0,
						lost: 0,
						gf: 0,
						ga: 0,
						points: 0,
					};

					// Group advancement status (only meaningful during group stage)
					const inGroupStage = stage === "group";
					const advStatus: AdvancementStatus | null = inGroupStage
						? getGroupAdvancementStatus(tIdx, gMatches)
						: null;

					return (
						<div
							key={tIdx}
							className={`my-team-card${!isAlive ? " eliminated-card" : ""}`}
						>
							<div className="mtc-header">
								<div className="mtc-flag-wrap">
									<img src={flagUrl(team.code)} alt={team.code} />
								</div>
								<div className="mtc-info">
									<div className="mtc-name">{shortName(team.name)}</div>
									<div className="mtc-meta">
										Group {team.group} • FIFA #{team.fifaRank}
									</div>
								</div>
								<div
									className={`mtc-pos-badge${advStatus ? ` ${advStatus}` : ""}`}
								>
									{pos ? `#${pos}` : "–"}
								</div>
							</div>

							<div className="mtc-stats-row">
								<div className="mtc-stat">
									<span className="mtc-stat-val">{standing.played}</span>
									<span className="mtc-stat-lbl">P</span>
								</div>
								<div className="mtc-stat">
									<span className="mtc-stat-val">{standing.won}</span>
									<span className="mtc-stat-lbl">W</span>
								</div>
								<div className="mtc-stat">
									<span className="mtc-stat-val">{standing.drawn}</span>
									<span className="mtc-stat-lbl">D</span>
								</div>
								<div className="mtc-stat">
									<span className="mtc-stat-val">{standing.lost}</span>
									<span className="mtc-stat-lbl">L</span>
								</div>
								<div className="mtc-stat">
									<span className="mtc-stat-val">
										{standing.played > 0
											? `${standing.gf - standing.ga > 0 ? "+" : ""}${standing.gf - standing.ga}`
											: "0"}
									</span>
									<span className="mtc-stat-lbl">GD</span>
								</div>
								<div className="mtc-stat mtc-stat-pts">
									<span className="mtc-stat-val">{standing.points}</span>
									<span className="mtc-stat-lbl">Pts</span>
								</div>
							</div>

							<span
								className={`mtc-status ${statusClassFor(advStatus, isAlive, stage)}`}
							>
								{statusTextFor(advStatus, isAlive, stage)}
							</span>

							<div className="mtc-matches">
								{teamGroupMatches.map((m) => {
									const opp = m.homeIdx === tIdx ? m.awayIdx : m.homeIdx;
									const oppTeam = TEAMS[opp];
									const isHome = m.homeIdx === tIdx;
									const myScore = isHome ? m.homeScore : m.awayScore;
									const oppScore = isHome ? m.awayScore : m.homeScore;
									const isLive = m.status === "live";

									return (
										<div
											key={m.id}
											className={`mtc-match${isLive ? " live" : ""}${m.played ? " played" : ""}`}
										>
											{/* Left: my team — flag over name */}
											<div className="mtc-match-side">
												<img
													className="mtc-match-flag"
													src={flagUrl(team.code)}
													alt={team.code}
												/>
												<span className="mtc-match-name">
													{shortName(team.name, 11)}
												</span>
											</div>

											{/* Center: status + score */}
											<div className="mtc-match-center">
												{isLive ? (
													<>
														<span className="mtc-match-status">
															<span className="match-live-dot" />
															{m.clock}
														</span>
														<span
															className={`mtc-match-score ${resultClass(myScore, oppScore)}`}
														>
															{myScore} – {oppScore}
														</span>
													</>
												) : m.played ? (
													<>
														<span className="mtc-match-status ft">FT</span>
														<span
															className={`mtc-match-score ${resultClass(myScore, oppScore)}`}
														>
															{myScore} – {oppScore}
														</span>
													</>
												) : (
													<span className="mtc-match-date">
														{m.date ? formatShort(m.date) : `MD${m.round}`}
													</span>
												)}
											</div>

											{/* Right: opponent — flag over name */}
											<div className="mtc-match-side">
												<img
													className="mtc-match-flag"
													src={flagUrl(oppTeam.code)}
													alt={oppTeam.code}
												/>
												<span className="mtc-match-name">
													{shortName(oppTeam.name, 11)}
												</span>
											</div>
										</div>
									);
								})}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function resultClass(myScore: number | null, oppScore: number | null): string {
	if (myScore === null || oppScore === null) return "";
	if (myScore > oppScore) return "win";
	if (myScore < oppScore) return "loss";
	return "draw";
}

type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "winner";

function statusClassFor(
	advStatus: AdvancementStatus | null,
	isAlive: boolean,
	stage: Stage,
): string {
	if (advStatus) return advStatus;
	if (!isAlive) return "eliminated";
	if (stage !== "group") return "alive";
	return "alive";
}

function statusTextFor(
	advStatus: AdvancementStatus | null,
	isAlive: boolean,
	stage: Stage,
): string {
	if (advStatus) {
		switch (advStatus) {
			case "clinched":
				return "✓ Clinched Top 2";
			case "bubble":
				return "Bubble — Best 3rd Race";
			case "atRisk":
				return "⚠ At Risk";
			case "eliminated":
				return "Eliminated";
		}
	}
	if (!isAlive) return "Eliminated";
	if (stage !== "group") return `Alive — ${stage.toUpperCase()} STAGE`;
	return "Alive — GROUP STAGE";
}

function formatShort(iso: string): string {
	const d = new Date(iso);
	return (
		d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
		" " +
		d.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
		})
	);
}
