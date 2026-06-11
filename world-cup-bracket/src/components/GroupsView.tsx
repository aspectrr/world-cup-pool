import { TEAMS, GROUPS, flagUrl, shortName } from "../data/teams";
import { PLAYERS } from "../data/players";

function teamOwner(teamIdx: number): string | null {
	for (const p of PLAYERS) {
		if (p.teamIndices.includes(teamIdx)) return p.name;
	}
	return null;
}

export function GroupsView() {
	return (
		<div>
			<div className="section-title">Group Stage</div>
			<div className="groups-grid">
				{GROUPS.map((group) => {
					const teams = TEAMS.map((t, i) => ({ ...t, idx: i }))
						.filter((t) => t.group === group)
						.sort((a, b) => a.groupPos - b.groupPos);

					return (
						<div key={group} className="group-card">
							<h3>Group {group}</h3>
							{teams.map((team, i) => {
								const owner = teamOwner(team.idx);
								const advancing = i < 2;
								return (
									<div
										key={team.idx}
										className={`group-team-row${advancing ? " advancing" : ""}`}
									>
										<div className="team-cell">
											<img src={flagUrl(team.code)} alt={team.code} />
											<span>{shortName(team.name)}</span>
										</div>
										{owner && (
											<span className="group-owner">{owner}</span>
										)}
									</div>
								);
							})}
						</div>
					);
				})}
			</div>
		</div>
	);
}
