import { TEAMS, GROUPS, flagUrl, shortName } from "../data/teams";
import { PLAYERS } from "../data/players";
import { calcGroupStandings } from "../utils/standings";
import type { GroupMatch } from "../types";

function teamOwner(teamIdx: number): string | null {
	for (const p of PLAYERS) {
		if (p.teamIndices.includes(teamIdx)) return p.name;
	}
	return null;
}

export function GroupsView({ matches }: { matches: GroupMatch[] }) {
	return (
		<div>
			<div className="section-title">Group Stage</div>
			<div className="groups-grid">
				{GROUPS.map((group) => {
					const groupMatches = matches.filter((m) => m.group === group);
					const standings = calcGroupStandings(groupMatches).get(group) ?? [];

					return (
						<div key={group} className="group-card">
							<h3>Group {group}</h3>

							<table className="group-table">
								<thead>
									<tr>
										<th style={{ width: "40%" }}>Team</th>
										<th className="num">P</th>
										<th className="num">W</th>
										<th className="num">D</th>
										<th className="num">L</th>
										<th className="num">GD</th>
										<th className="num pts">Pts</th>
									</tr>
								</thead>
								<tbody>
									{standings.map((s, i) => {
										const team = TEAMS[s.teamIdx];
										const owner = teamOwner(s.teamIdx);
										const advancing = i < 2;
										return (
											<tr
												key={s.teamIdx}
												className={advancing ? "advancing" : ""}
											>
												<td>
													<div className="team-cell">
														<img src={flagUrl(team.code)} alt={team.code} />
														<span>{shortName(team.name)}</span>
														{owner && (
															<span
																style={{
																	fontSize: "0.55rem",
																	color: "var(--gold)",
																	marginLeft: "auto",
																}}
															>
																{owner}
															</span>
														)}
													</div>
												</td>
												<td className="num">{s.played}</td>
												<td className="num">{s.won}</td>
												<td className="num">{s.drawn}</td>
												<td className="num">{s.lost}</td>
												<td className="num">
													{s.gf - s.ga > 0 ? "+" : ""}
													{s.gf - s.ga}
												</td>
												<td className="num pts">{s.points}</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					);
				})}
			</div>
		</div>
	);
}
