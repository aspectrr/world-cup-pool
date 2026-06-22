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
const ROUND_COL: Record<string, number> = {
	R32: 1,
	R16: 2,
	QF: 3,
	SF: 4,
	FINAL: 5,
};
// Row span per round: R32 takes 1 of 16 rows, FINAL spans all 16.
const ROUND_SPAN: Record<string, number> = {
	R32: 1,
	R16: 2,
	QF: 4,
	SF: 8,
	FINAL: 16,
};
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
	clinchedWinners,
}: {
	matches: KnockoutMatch[];
	setMatches: React.Dispatch<React.SetStateAction<KnockoutMatch[]>>;
	gMatches: GroupMatch[];
	clinchedWinners: Set<number>;
}) {
	const allGroupPlayed = gMatches.length > 0 && gMatches.every((m) => m.played);
	const r32Populated = matches.some(
		(m) => m.round === "R32" && m.homeIdx !== null,
	);

	// Auto-populate R32: fill winner slots as groups clinch, full bracket
	// (runners + best thirds) once every group match is played.
	useEffect(() => {
		setMatches((prev) => {
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
				const w = gs[0]?.teamIdx ?? null;
				// Winner slot: fill only once clinched OR group fully decided.
				winners[g] =
					w !== null && (clinchedWinners.has(w) || allGroupPlayed)
						? w
						: null;
			// Runner / third slots: only once every group match is played.
				runners[g] = allGroupPlayed ? (gs[1]?.teamIdx ?? null) : null;
				if (allGroupPlayed && gs[2])
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

			let changed = false;
			const updated = prev.map((m) => {
				const slot = r32Slots.find(([id]) => id === m.id);
				if (!slot) return m;
				const [, home, away] = slot;
				if (m.homeIdx === home && m.awayIdx === away) return m;
				changed = true;
				return { ...m, homeIdx: home, awayIdx: away };
			});
			return changed ? updated : prev;
		});
	}, [allGroupPlayed, gMatches, clinchedWinners, setMatches]);

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
					Clinched group winners shown; bracket fills fully once group stage ends
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
				<div className="bracket-titles">
					{rounds.map(({ round }) => (
						<div key={round} className="bracket-round-title">
							{ROUND_LABELS[round]}
						</div>
					))}
				</div>
				<div className="bracket-grid">
					{rounds.map(({ round, matches: rms }) =>
						rms.map((m, i) => {
							const span = ROUND_SPAN[round]!;
							const pos =
								round === "FINAL"
									? "single"
									: i % 2 === 0
										? "top"
										: "bottom";
							return (
								<div
									key={m.id}
									className="bracket-cell"
									data-round={round}
									data-pos={pos}
									style={{
										gridColumn: ROUND_COL[round],
										gridRow: `${i * span + 1} / span ${span}`,
									}}
								>
									<MatchCard m={m} />
								</div>
							);
						}),
					)}
				</div>
			</div>
		</div>
	);
}
