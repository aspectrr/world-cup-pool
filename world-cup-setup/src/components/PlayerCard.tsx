import { TEAMS, flagUrl } from "../data/teams";

interface Props {
	playerName: string;
	teamIndices: number[];
	isDrawing: boolean;
}

export function PlayerCard({ playerName, teamIndices, isDrawing }: Props) {
	return (
		<div className={`player-card${isDrawing ? " drawing" : ""}`}>
			<div className="player-name">
				<span>{playerName}</span>
				<span className="count">{teamIndices.length}/6</span>
			</div>
			<div className="player-teams">
				{teamIndices.length === 0 ? (
					<span className="empty-slots">—</span>
				) : (
					teamIndices.map((ti) => {
						const t = TEAMS[ti];
						return (
							<div className="team-chip" key={ti}>
								<img
									src={flagUrl(t.code)}
									alt={t.code}
									onError={(e) =>
										((e.target as HTMLImageElement).style.display = "none")
									}
								/>
								<span className="chip-name">{t.name}</span>
								<span className="group-label">
									{t.group} · #{t.groupPos} · FIFA #{t.fifaRank}
								</span>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
