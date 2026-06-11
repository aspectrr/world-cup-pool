import { useEffect } from "react";
import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import { calcGroupStandings } from "../utils/standings";

function MatchCard({ m }: { m: KnockoutMatch }) {
	const home = m.homeIdx !== null ? TEAMS[m.homeIdx] : null;
	const away = m.awayIdx !== null ? TEAMS[m.awayIdx] : null;
	const homeWon =
		m.played &&
		m.homeScore !== null &&
		m.awayScore !== null &&
		m.homeScore > m.awayScore;
	const awayWon =
		m.played &&
		m.homeScore !== null &&
		m.awayScore !== null &&
		m.awayScore > m.homeScore;

	return (
		<div className="bracket-match">
			<div className={`bracket-slot${homeWon ? " winner" : ""}`}>
				{home ? (
					<>
						<img src={flagUrl(home.code)} alt={home.code} />
						<span>{shortName(home.name)}</span>
					</>
				) : (
					<span className="tbd">{m.homeSeed}</span>
				)}
				{m.played && m.homeScore !== null && (
					<span className="score">{m.homeScore}</span>
				)}
			</div>
			<div className={`bracket-slot${awayWon ? " winner" : ""}`}>
				{away ? (
					<>
						<img src={flagUrl(away.code)} alt={away.code} />
						<span>{shortName(away.name)}</span>
					</>
				) : (
					<span className="tbd">{m.awaySeed}</span>
				)}
				{m.played && m.awayScore !== null && (
					<span className="score">{m.awayScore}</span>
				)}
			</div>
		</div>
	);
}

const ROUND_LABELS: Record<string, string> = {
	R32: "Round of 32",
	R16: "Round of 16",
	QF: "Quarter Finals",
	SF: "Semi Finals",
	FINAL: "Final",
};

const ROUND_ORDER = ["R32", "R16", "QF", "SF", "FINAL"];
const GROUPS_LIST = [
	"A",
	"B",
	"C",
	"D",
	"E",
	"F",
	"G",
	"H",
	"I",
	"J",
	"K",
	"L",
];

export function BracketView({
	matches,
	setMatches,
	gMatches,
}: {
	matches: KnockoutMatch[];
	setMatches: React.Dispatch<React.SetStateAction<KnockoutMatch[]>>;
	gMatches: GroupMatch[];
}) {
	const allGroupPlayed = gMatches.length > 0 && gMatches.every((m) => m.played);
	const r32Populated = matches.some(
		(m) => m.round === "R32" && m.homeIdx !== null,
	);

	// Auto-populate R32 from group standings when all group matches complete
	useEffect(() => {
		if (!allGroupPlayed || r32Populated) return;

		setMatches((prev) => {
			const updated = [...prev];
			const standings = calcGroupStandings(gMatches);

			const winners: Record<string, number | null> = {};
			const runners: Record<string, number | null> = {};
			const thirds: {
				group: string;
				idx: number;
				points: number;
				gd: number;
			}[] = [];

			for (const g of GROUPS_LIST) {
				const gs = standings.get(g) ?? [];
				winners[g] = gs[0]?.teamIdx ?? null;
				runners[g] = gs[1]?.teamIdx ?? null;
				if (gs[2])
					thirds.push({
						group: g,
						idx: gs[2].teamIdx,
						points: gs[2].points,
						gd: gs[2].gf - gs[2].ga,
					});
			}

			thirds.sort((a, b) => b.points - a.points || b.gd - a.gd);
			const bestThirds = thirds.slice(0, 8);
			const getThird = (i: number) => bestThirds[i]?.idx ?? null;

			const r32Slots: [string, number | null, number | null][] = [
				["R32-1", winners["A"], runners["B"]],
				["R32-2", winners["C"], runners["D"]],
				["R32-3", winners["E"], runners["F"]],
				["R32-4", winners["G"], runners["H"]],
				["R32-5", winners["B"], getThird(0)],
				["R32-6", winners["D"], getThird(1)],
				["R32-7", winners["F"], getThird(2)],
				["R32-8", winners["H"], getThird(3)],
				["R32-9", winners["I"], runners["J"]],
				["R32-10", winners["K"], runners["L"]],
				["R32-11", runners["A"], getThird(4)],
				["R32-12", runners["C"], getThird(5)],
				["R32-13", runners["E"], getThird(6)],
				["R32-14", runners["G"], getThird(7)],
				["R32-15", runners["I"], runners["K"]],
				["R32-16", runners["J"], runners["L"]],
			];

			for (const [matchId, home, away] of r32Slots) {
				const idx = updated.findIndex((m) => m.id === matchId);
				if (idx !== -1) {
					updated[idx] = { ...updated[idx], homeIdx: home, awayIdx: away };
				}
			}

			return updated;
		});
	}, [allGroupPlayed, r32Populated, gMatches, setMatches]);

	const rounds = ROUND_ORDER.map((round) => ({
		round,
		matches: matches.filter((m) => m.round === round),
	}));

	return (
		<div>
			<div className="section-title">Knockout Stage</div>
			{!allGroupPlayed ? (
				<div
					style={{
						textAlign: "center",
						color: "var(--text-dim)",
						fontSize: "0.8rem",
						marginBottom: 12,
					}}
				>
					Bracket fills automatically once all group matches are complete
				</div>
			) : !r32Populated ? (
				<div
					style={{
						textAlign: "center",
						color: "var(--green)",
						fontSize: "0.8rem",
						marginBottom: 12,
					}}
				>
					Group stage complete — populating bracket…
				</div>
			) : null}
			<div className="bracket-scroll">
				<div className="bracket-container">
					{rounds.map(({ round, matches: roundMatches }) => (
						<div key={round} className="bracket-round">
							<div className="bracket-round-title">{ROUND_LABELS[round]}</div>
							{roundMatches.map((m) => (
								<MatchCard key={m.id} m={m} />
							))}
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
