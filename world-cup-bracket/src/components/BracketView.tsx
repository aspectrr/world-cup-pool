import { useEffect } from "react";
import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import {
	R32_SLOTS,
	seedLabel,
	populateR32,
	type SeedSpec,
} from "../data/bracket";
import { PLAYERS } from "../data/players";

// teamIdx -> owning player name
const TEAM_OWNER = new Map<number, string>();
for (const p of PLAYERS) {
	for (const idx of p.teamIndices) TEAM_OWNER.set(idx, p.name);
}

function MatchCard({
	m,
	liveTeamIdxs,
}: {
	m: KnockoutMatch;
	liveTeamIdxs: Set<number>;
}) {
	const home = m.homeIdx !== null ? TEAMS[m.homeIdx] : null;
	const away = m.awayIdx !== null ? TEAMS[m.awayIdx] : null;
	const homeLive = m.homeIdx !== null && liveTeamIdxs.has(m.homeIdx);
	const awayLive = m.awayIdx !== null && liveTeamIdxs.has(m.awayIdx);
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
			<div className={`bracket-slot${homeWon ? " winner" : ""}${homeLive ? " live" : ""}`}>
				{home ? (
					<>
						<img src={flagUrl(home.code)} alt={home.code} />
						<span>{shortName(home.name)}</span>
						{homeLive && <span className="slot-live-dot" />}
						<span className="owner">{TEAM_OWNER.get(m.homeIdx!)}</span>
					</>
				) : (
					<span className="tbd">{m.homeSeed}</span>
				)}
				{m.played && m.homeScore !== null && (
					<span className="score">{m.homeScore}</span>
				)}
			</div>
			<div className={`bracket-slot${awayWon ? " winner" : ""}${awayLive ? " live" : ""}`}>
				{away ? (
					<>
						<img src={flagUrl(away.code)} alt={away.code} />
						<span>{shortName(away.name)}</span>
						{awayLive && <span className="slot-live-dot" />}
						<span className="owner">{TEAM_OWNER.get(m.awayIdx!)}</span>
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

export function BracketView({
	matches,
	setMatches,
	gMatches,
	clinchedWinners,
	liveTeamIdxs,
}: {
	matches: KnockoutMatch[];
	setMatches: React.Dispatch<React.SetStateAction<KnockoutMatch[]>>;
	gMatches: GroupMatch[];
	clinchedWinners: Set<number>;
	liveTeamIdxs: Set<number>;
}) {
	const allGroupPlayed = gMatches.length > 0 && gMatches.every((m) => m.played);
	const r32Populated = matches.some(
		(m) => m.round === "R32" && m.homeIdx !== null,
	);

	// Auto-populate R32 from group results. Pure derivation lives in
	// populateR32 — this effect just merges the result into state.
	useEffect(() => {
		setMatches((prev) => {
			const r32 = populateR32(gMatches, clinchedWinners);

			// Re-seed labels too (third-place slots resolve once groups end).
			const thirdGroupFor = new Map<string, string | null>();
			// Walk R32_SLOTS in parallel with prev's R32 entries; the third label
			// needs the resolved group, which we get by re-reading the slot spec.
			// ponytail: assumes R32_SLOTS ordering matches generateKnockoutMatches.
			for (const slot of R32_SLOTS) {
				const filled = r32.get(slot.id);
				thirdGroupFor.set(
					slot.id,
					filled && slot.home.kind === "3"
						? groupLetterOf(filled[0])
						: filled && slot.away.kind === "3"
							? groupLetterOf(filled[1])
							: null,
				);
			}

			let changed = false;
			const updated = prev.map((m) => {
				if (m.round !== "R32") return m;
				const slot = R32_SLOTS.find((s) => s.id === m.id);
				if (!slot) return m;
				const filled = r32.get(m.id);
				if (!filled) return m;
				const [home, away] = filled;
				const tg = thirdGroupFor.get(m.id) ?? null;
				const homeSeed = seedLabel(slot.home, groupLetterOfIfThird(slot.home, tg));
				const awaySeed = seedLabel(slot.away, groupLetterOfIfThird(slot.away, tg));
				if (
					m.homeIdx === home &&
					m.awayIdx === away &&
					m.homeSeed === homeSeed &&
					m.awaySeed === awaySeed
				) {
					return m;
				}
				changed = true;
				return { ...m, homeIdx: home, awayIdx: away, homeSeed, awaySeed };
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
			{allGroupPlayed && !r32Populated ? (
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
								round === "FINAL" ? "single" : i % 2 === 0 ? "top" : "bottom";
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
									<MatchCard m={m} liveTeamIdxs={liveTeamIdxs} />
								</div>
							);
						}),
					)}
				</div>
			</div>
		</div>
	);
}

function groupLetterOf(idx: number | null): string | null {
	if (idx === null) return null;
	return TEAMS[idx].group;
}

// When the seed is a third-place slot, return the resolved group letter;
// otherwise return null (the label ignores it for winner/runner specs).
function groupLetterOfIfThird(spec: SeedSpec, tg: string | null): string | null {
	return spec.kind === "3" ? tg : null;
}
