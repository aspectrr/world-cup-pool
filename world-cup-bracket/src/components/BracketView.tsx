import { useEffect, useMemo, useRef } from "react";
import type { KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import { PLAYERS } from "../data/players";
import { knockoutWinner } from "../utils/standings";

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

// FIFA-style 3-letter abbreviations; default to first-3 of name with
// overrides for multi-word / ambiguous codes.
const ABBR_OVERRIDE: Record<string, string> = {
	us: "USA",
	ba: "BIH",
	cd: "COD",
	cv: "CPV",
	ci: "CIV",
	ch: "SUI",
	at: "AUT",
	gb: "ENG",
};
function abbr(name: string, code: string): string {
	return ABBR_OVERRIDE[code] ?? name.slice(0, 3).toUpperCase();
}

/** Render a "Winner MXX" slot as a feeder matchup preview:
 * [flag abbr v flag abbr datetime] when both feeder teams are known. */
function SeedPreview({
	seed,
	matchById,
}: {
	seed: string;
	matchById: Map<string, KnockoutMatch>;
}) {
	const feederId = seed.match(/Winner (\w+)/)?.[1] ?? null;
	const feeder = feederId ? matchById.get(feederId) : undefined;
	const h = feeder?.homeIdx !== null && feeder?.homeIdx !== undefined ? TEAMS[feeder.homeIdx] : null;
	const a = feeder?.awayIdx !== null && feeder?.awayIdx !== undefined ? TEAMS[feeder.awayIdx] : null;
	if (!h || !a) return <span className="tbd">{seed}</span>;
	return (
		<span className="seed-preview">
			<img src={flagUrl(h.code)} alt={h.code} />
			<span className="seed-abbr">{abbr(h.name, h.code)}</span>
			<span className="seed-vs">v</span>
			<img src={flagUrl(a.code)} alt={a.code} />
			<span className="seed-abbr">{abbr(a.name, a.code)}</span>
			{feeder?.date && (
				<span className="seed-time">{formatKickoff(feeder.date)}</span>
			)}
		</span>
	);
}

function MatchCard({
	m,
	liveTeamIdxs,
	matchById,
}: {
	m: KnockoutMatch;
	liveTeamIdxs: Set<number>;
	matchById: Map<string, KnockoutMatch>;
}) {
	const home = m.homeIdx !== null ? TEAMS[m.homeIdx] : null;
	const away = m.awayIdx !== null ? TEAMS[m.awayIdx] : null;
	const homeLive = m.homeIdx !== null && liveTeamIdxs.has(m.homeIdx);
	const awayLive = m.awayIdx !== null && liveTeamIdxs.has(m.awayIdx);
	const winnerIdx = knockoutWinner(m);
	const homeWon = winnerIdx !== null && winnerIdx === m.homeIdx;
	const awayWon = winnerIdx !== null && winnerIdx === m.awayIdx;

	return (
		<div className="bracket-match">
			<div className={`bracket-slot${homeWon ? " winner" : ""}${homeLive ? " live" : ""}`}>
				{m.status === "live" && m.clock && (
					<span className="bracket-live-clock">
						<span className="live-pip" />
						{m.detail === "HT" ? "HT" : m.clock}
					</span>
				)}
				{home ? (
					<>
						<img src={flagUrl(home.code)} alt={home.code} />
						<span>{shortName(home.name)}</span>
						<span className="owner">{TEAM_OWNER.get(m.homeIdx!)}</span>
					</>
				) : (
					<SeedPreview seed={m.homeSeed} matchById={matchById} />
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
					<SeedPreview seed={m.awaySeed} matchById={matchById} />
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
	liveTeamIdxs,
}: {
	matches: KnockoutMatch[];
	liveTeamIdxs: Set<number>;
}) {
	const matchById = useMemo(
		() => new Map(matches.map((m) => [m.id, m])),
		[matches],
	);
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
									<MatchCard m={m} liveTeamIdxs={liveTeamIdxs} matchById={matchById} />
								</div>
							);
						}),
					)}
				</div>
			</div>
		</div>
	);
}
