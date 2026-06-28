import { useEffect, useMemo, useRef } from "react";
import type { KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import { PLAYERS } from "../data/players";

// teamIdx -> owning player name
const TEAM_OWNER = new Map<number, string>();
for (const p of PLAYERS) {
	for (const idx of p.teamIndices) TEAM_OWNER.set(idx, p.name);
}

function formatKickoff(iso?: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return d.toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
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
	const showKickoff = !m.played && (home || away) && !!m.date;

	return (
		<div className="bracket-match">
			<div className={`bracket-slot${homeWon ? " winner" : ""}${homeLive ? " live" : ""}`}>
				{m.status === "live" && m.clock && (
					<span className="bracket-live-clock">
						<span className="live-pip" />
						{m.clock}
					</span>
				)}
				{home ? (
					<>
						<img src={flagUrl(home.code)} alt={home.code} />
						<span>{shortName(home.name)}</span>
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
						<span className="owner">{TEAM_OWNER.get(m.awayIdx!)}</span>
					</>
				) : (
					<span className="tbd">{m.awaySeed}</span>
				)}
				{m.played && m.awayScore !== null && (
					<span className="score">{m.awayScore}</span>
				)}
			</div>
			{showKickoff && <div className="bracket-kickoff">{formatKickoff(m.date)}</div>}
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
	liveTeamIdxs,
}: {
	matches: KnockoutMatch[];
	liveTeamIdxs: Set<number>;
}) {
	const rounds = ROUND_ORDER.map((round) => ({
		round,
		matches: matches.filter((m) => m.round === round),
	}));

	// Active round = round with a live game; else first round with unplayed
	// games; else FINAL. Used to auto-center the bracket on mount.
	const activeRound = useMemo(() => {
		for (const r of ROUND_ORDER) {
			if (matches.some((m) => m.round === r && m.status === "live")) return r;
		}
		for (const r of ROUND_ORDER) {
			if (matches.some((m) => m.round === r && !m.played)) return r;
		}
		return "FINAL";
	}, [matches]);

	const scrollRef = useRef<HTMLDivElement>(null);

	// Center the active round's column whenever it shifts. Re-centers on mount
	// and when the action moves to the next round (R32 done → R16, etc.).
	useEffect(() => {
		const container = scrollRef.current;
		if (!container) return;
		const title = container.querySelector<HTMLElement>(
			`.bracket-round-title[data-round="${activeRound}"]`,
		);
		if (!title) return;
		const target =
			title.offsetLeft - container.clientWidth / 2 + title.offsetWidth / 2;
		container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
	}, [activeRound]);

	return (
		<div>
			<div className="section-title">Knockout Stage</div>
			<div className="bracket-scroll" ref={scrollRef}>
				<div className="bracket-titles">
					{rounds.map(({ round }) => (
						<div
							key={round}
							className="bracket-round-title"
							data-round={round}
						>
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
