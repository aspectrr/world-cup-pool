import { TEAMS, flagUrl } from "../data/teams";

interface Props {
	teamIdx: number;
	onNext: () => void;
}

export function ResultReveal({ teamIdx, onNext }: Props) {
	const team = TEAMS[teamIdx];

	return (
		<div className="result-reveal active">
			<img
				className="team-flag"
				src={flagUrl(team.code)}
				alt={team.code}
				onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
			/>
			<div className="team-name">{team.name}</div>
			<div className="reveal-badges">
				<span className="group-badge">Group {team.group}</span>
				<span className="rank-badge">Seed #{team.groupPos}</span>
				<span className="rank-badge">FIFA #{team.fifaRank}</span>
			</div>
			<button className="btn-next" onClick={onNext}>
				Continue
			</button>
		</div>
	);
}
