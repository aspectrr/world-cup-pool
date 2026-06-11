import { useState, useMemo } from "react";
import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, flagUrl } from "../data/teams";
import { PLAYERS } from "../data/players";
import {
	calcGroupStandings,
	getAliveTeams,
	getTeamStage,
} from "../utils/standings";

export function MyTeams({
	gMatches,
	kMatches,
}: {
	gMatches: GroupMatch[];
	kMatches: KnockoutMatch[];
}) {
	const [selectedPlayer, setSelectedPlayer] = useState(0);
	const player = PLAYERS[selectedPlayer];
	const alive = useMemo(
		() => getAliveTeams(gMatches, kMatches),
		[gMatches, kMatches],
	);
	const standings = useMemo(() => calcGroupStandings(gMatches), [gMatches]);

	return (
		<div>
			<div className="section-title">My Teams</div>

			<div className="player-selector">
				{PLAYERS.map((p, i) => (
					<button
						key={p.name}
						className={`player-pill${i === selectedPlayer ? " active" : ""}`}
						onClick={() => setSelectedPlayer(i)}
					>
						{p.name}
					</button>
				))}
			</div>

			<div className="my-teams-grid">
				{player.teamIndices.map((tIdx) => {
					const team = TEAMS[tIdx];
					const isAlive = alive.has(tIdx);
					const stage = getTeamStage(tIdx, kMatches);

					// Get this team's group matches
					const teamGroupMatches = gMatches.filter(
						(m) => m.homeIdx === tIdx || m.awayIdx === tIdx,
					);

					// Get group standing position
					const groupStandings = standings.get(team.group) ?? [];
					const pos = groupStandings.findIndex((s) => s.teamIdx === tIdx) + 1;
					const standing = groupStandings.find((s) => s.teamIdx === tIdx);

					return (
						<div key={tIdx} className="my-team-card">
							<div className="team-header">
								<img src={flagUrl(team.code)} alt={team.code} />
								<div>
									<div className="team-name">{team.name}</div>
									<div className="team-group">
										Group {team.group} • Pos {pos || "–"} • FIFA #
										{team.fifaRank}
									</div>
								</div>
							</div>

							<span
								className={`team-status ${isAlive ? "alive" : "eliminated"}`}
							>
								{isAlive ? `Alive — ${stage.toUpperCase()}` : "Eliminated"}
							</span>

							{standing && (
								<div
									style={{
										marginTop: 8,
										fontSize: "0.72rem",
										color: "var(--text-dim)",
									}}
								>
									{standing.played}P {standing.won}W {standing.drawn}D{" "}
									{standing.lost}L • {standing.points} pts
									{standing.played > 0 &&
										` (GD ${standing.gf - standing.ga > 0 ? "+" : ""}${standing.gf - standing.ga})`}
								</div>
							)}

							<div className="team-matches">
								{teamGroupMatches.map((m) => {
									const opp = m.homeIdx === tIdx ? m.awayIdx : m.homeIdx;
									const oppTeam = TEAMS[opp];
									const isHome = m.homeIdx === tIdx;
									const myScore = isHome ? m.homeScore : m.awayScore;
									const oppScore = isHome ? m.awayScore : m.homeScore;

									return (
										<div
											key={m.id}
											className={`group-match-row${m.status === "live" ? " live" : ""}`}
										>
											<div className="teams">
												<img
													className="team-flag-sm"
													src={flagUrl(oppTeam.code)}
													alt={oppTeam.code}
												/>
												<span>vs {oppTeam.name}</span>
											</div>
											{m.status === "live" ? (
												<div
													style={{
														display: "flex",
														flexDirection: "column",
														alignItems: "center",
													}}
												>
													<div className="score">
														<span
															style={{
																color:
																	(myScore ?? 0) > (oppScore ?? 0)
																		? "var(--green)"
																		: (myScore ?? 0) < (oppScore ?? 0)
																			? "var(--red)"
																			: "var(--gold-light)",
															}}
														>
															{myScore} – {oppScore}
														</span>
													</div>
													<div className="match-live-clock">
														<span className="match-live-dot" />
														{m.clock}
													</div>
												</div>
											) : m.played ? (
												<div className="score">
													<span
														style={{
															color:
																(myScore ?? 0) > (oppScore ?? 0)
																	? "var(--green)"
																	: (myScore ?? 0) < (oppScore ?? 0)
																		? "var(--red)"
																		: "var(--gold-light)",
														}}
													>
														{myScore} – {oppScore}
													</span>
												</div>
								) : (
									<div className="vs">
										{m.date
											? new Date(m.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
												" " +
												new Date(m.date).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
											: `MD${m.round}`}
									</div>
								)}
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
