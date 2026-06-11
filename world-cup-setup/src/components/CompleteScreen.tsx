import { TEAMS, flagUrl } from "../data/teams";

interface Props {
	players: string[];
	playerTeams: number[][];
	onRedraw: () => void;
}

export function CompleteScreen({ players, playerTeams, onRedraw }: Props) {
	return (
		<section className="complete-screen active">
			<h2>🏆 Draw Complete!</h2>
			<div className="final-grid">
				{players.map((p, i) => {
					const teams = playerTeams[i].map((ti) => TEAMS[ti]);
					const avgRank = Math.round(
						teams.reduce((s, t) => s + t.fifaRank, 0) / teams.length,
					);
					return (
						<div className="final-card" key={i}>
							<h3>
								{p} <span className="avg-rank">Avg Rank: #{avgRank}</span>
							</h3>
							{teams.map((t) => (
								<div className="final-team-row" key={t.name}>
									<img
										src={flagUrl(t.code)}
										alt={t.code}
										onError={(e) =>
											((e.target as HTMLImageElement).style.display = "none")
										}
									/>
									<div className="team-info">
										<div className="name">{t.name}</div>
										<div className="group">
											Group {t.group} · Seed #{t.groupPos} · FIFA #{t.fifaRank}
										</div>
									</div>
								</div>
							))}
						</div>
					);
				})}
			</div>
			<button className="btn-redraw" onClick={onRedraw}>
				🔄 Redraw
			</button>
		</section>
	);
}
