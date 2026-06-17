import { TEAMS, GROUPS, flagUrl, shortName } from "../data/teams";
import { PLAYERS } from "../data/players";
import type { GroupMatch, GroupStanding } from "../types";

function teamOwner(teamIdx: number): string | null {
	for (const p of PLAYERS) {
		if (p.teamIndices.includes(teamIdx)) return p.name;
	}
	return null;
}

/** Build standings from matches — always includes all 4 teams per group */
function buildStandings(matches: GroupMatch[]): Map<string, GroupStanding[]> {
	const map = new Map<string, GroupStanding[]>();

	// Initialize every team with zeroes
	for (const group of GROUPS) {
		const teams = TEAMS.map((t, i) => ({ ...t, idx: i }))
			.filter((t) => t.group === group)
			.sort((a, b) => a.groupPos - b.groupPos);

		map.set(
			group,
			teams.map((t) => ({
				teamIdx: t.idx,
				played: 0,
				won: 0,
				drawn: 0,
				lost: 0,
				gf: 0,
				ga: 0,
				points: 0,
			})),
		);
	}

	// Fill in from played matches
	for (const m of matches) {
		if (!m.played || m.homeScore === null || m.awayScore === null) continue;

		const standings = map.get(m.group);
		if (!standings) continue;

		const home = standings.find((s) => s.teamIdx === m.homeIdx)!;
		const away = standings.find((s) => s.teamIdx === m.awayIdx)!;

		home.played++;
		away.played++;
		home.gf += m.homeScore;
		home.ga += m.awayScore;
		away.gf += m.awayScore;
		away.ga += m.homeScore;

		if (m.homeScore > m.awayScore) {
			home.won++;
			home.points += 3;
			away.lost++;
		} else if (m.homeScore < m.awayScore) {
			away.won++;
			away.points += 3;
			home.lost++;
		} else {
			home.drawn++;
			away.drawn++;
			home.points++;
			away.points++;
		}
	}

	// Sort: points, GD, GF
	for (const [, standings] of map) {
		standings.sort((a, b) => {
			if (b.points !== a.points) return b.points - a.points;
			const gdA = a.gf - a.ga;
			const gdB = b.gf - b.ga;
			if (gdB !== gdA) return gdB - gdA;
			return b.gf - a.gf;
		});
	}

	return map;
}

export function GroupsView({
	matches,
	advancing,
}: {
	matches: GroupMatch[];
	advancing: Set<number>;
}) {
	const standings = buildStandings(matches);

	return (
		<div>
			<div className="section-title">Group Stage</div>
			<div className="groups-grid">
				{GROUPS.map((group) => {
					const groupStandings = standings.get(group) ?? [];

					return (
						<div key={group} className="group-card">
							<h3>Group {group}</h3>

							<table className="group-table">
								<thead>
									<tr>
										<th className="team-col">Team</th>
										<th className="num">P</th>
										<th className="num">W</th>
										<th className="num">D</th>
										<th className="num">L</th>
										<th className="num">GD</th>
										<th className="num pts">Pts</th>
									</tr>
								</thead>
								<tbody>
									{groupStandings.map((s, i) => {
										const team = TEAMS[s.teamIdx];
										const owner = teamOwner(s.teamIdx);
										const isTop2 = i < 2;
										const isBestThird = advancing.has(s.teamIdx);
										const rowClass = isTop2
											? "advancing"
											: isBestThird
												? "advancing-third"
												: "";
										return (
											<tr key={s.teamIdx} className={rowClass}>
												<td>
													<div className="team-cell">
														<img src={flagUrl(team.code)} alt={team.code} />
														<span>{shortName(team.name)}</span>
														{isBestThird && !isTop2 && (
															<span className="third-marker">3rd</span>
														)}
														{owner && (
															<span className="group-owner">{owner}</span>
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
