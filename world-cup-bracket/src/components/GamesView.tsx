import { useMemo, useState, useRef, useEffect } from "react";
import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import { PLAYERS } from "../data/players";
import { oddsKey, type MatchOdds } from "../hooks/useLive";

function teamOwner(teamIdx: number): string | null {
	for (const p of PLAYERS) {
		if (p.teamIndices.includes(teamIdx)) return p.name;
	}
	return null;
}

interface GameMatch {
	id: string;
	date: string;
	homeIdx: number;
	awayIdx: number;
	homeScore: number | null;
	awayScore: number | null;
	status: "scheduled" | "live" | "finished";
	clock: string;
	round: string; // "Group A" or "R32" etc
	detail?: string;
	// Winner team idx for knockout games decided by ET or pens (tied score).
	// Lets the Games tab flag the advancing team. Null for group matches.
	winnerIdx?: number | null;
}

interface DayGroup {
	key: string; // YYYY-MM-DD (local)
	label: string; // "Thu, Jun 11"
	weekday: string; // "THU"
	monthDay: string; // "Jun 11"
	games: GameMatch[];
}

/** Local-day key from ISO string (so grouping matches user's calendar). */
function dayKey(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate(),
	).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
	if (!iso) return "TBD";
	const d = new Date(iso);
	return d.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

function formatTime(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return d.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
}

/** Finished-match badge. Plain "FT" is dropped — the dimmed row + scores
 *  already say finished; only the exceptions (pens, AET) earn a pill. */
function finishBadge(
	detail: string | undefined,
): { label: string; variant: "pens" | "aet" } | null {
	if (!detail) return null;
	const d = detail.toLowerCase();
	if (d.includes("pen")) return { label: "Pens", variant: "pens" };
	if (d.includes("aet") || d.includes("after extra"))
		return { label: "AET", variant: "aet" };
	return null;
}

function GameRow({ m, odds }: { m: GameMatch; odds?: MatchOdds }) {
	const home = TEAMS[m.homeIdx];
	const away = TEAMS[m.awayIdx];
	const homeOwner = teamOwner(m.homeIdx);
	const awayOwner = teamOwner(m.awayIdx);
	const isLive = m.status === "live";
	const isFinished = m.status === "finished";
	// Reserve the odds slot for scheduled + live games even when no market
	// exists yet — render a dash instead of leaving blank space.
	const showOdds = isLive || m.status === "scheduled";
	const homePct = odds?.pcts[m.homeIdx];
	const awayPct = odds?.pcts[m.awayIdx];
	// Knockout games decided by penalties finish level on regulation
	// score — flag the advancing side so the winner is unambiguous.
	const pensDecided =
		isFinished &&
		m.detail?.includes("Pens") &&
		m.winnerIdx !== null &&
		m.winnerIdx !== undefined;
	const homeWonPens = pensDecided && m.winnerIdx === m.homeIdx;
	const awayWonPens = pensDecided && m.winnerIdx === m.awayIdx;

	return (
		<div
			className={`game-row${isLive ? " live" : ""}${isFinished ? " finished" : ""}`}
		>
			<div className="game-teams">
				<div className="game-team">
					<div className="game-team-main">
						<img src={flagUrl(home.code)} alt={home.code} />
						<span className="game-team-name">{shortName(home.name)}</span>
					</div>
					{showOdds &&
						(homePct !== undefined ? (
							<span className="game-odds">{(homePct * 100).toFixed(2)}%</span>
						) : (
							<span className="game-odds game-odds-empty" aria-label="odds pending">—</span>
						))}
					{homeOwner && <span className="game-owner">{homeOwner}</span>}
				</div>
				<div className="game-team">
					<div className="game-team-main">
						<img src={flagUrl(away.code)} alt={away.code} />
						<span className="game-team-name">{shortName(away.name)}</span>
					</div>
					{showOdds &&
						(awayPct !== undefined ? (
							<span className="game-odds">{(awayPct * 100).toFixed(2)}%</span>
						) : (
							<span className="game-odds game-odds-empty" aria-label="odds pending">—</span>
						))}
					{awayOwner && <span className="game-owner">{awayOwner}</span>}
				</div>
			</div>
			<div className="game-score-col">
				{isLive ? (
					<>
						<span className="game-score-num">{m.homeScore}</span>
						<span className="game-score-num">{m.awayScore}</span>
					</>
				) : isFinished ? (
					<>
						<span className={`game-score-num${homeWonPens ? " pens-won" : ""}`}>
							{m.homeScore}
						</span>
						<span className={`game-score-num${awayWonPens ? " pens-won" : ""}`}>
							{m.awayScore}
						</span>
					</>
				) : (
					<>
						<span className="game-score-dash">-</span>
						<span className="game-score-dash">-</span>
					</>
				)}
			</div>
			<div className="game-meta">
				{isLive && (
					<div className="game-live-indicator">
						<span className="match-live-dot" />
						{m.detail === "HT" ? "HT" : m.clock}
					</div>
				)}
				{!isLive && m.date && (
					<span className="game-time">{formatTime(m.date)}</span>
				)}
				{isFinished && (() => {
					const badge = finishBadge(m.detail);
					return badge ? (
						<span className={`game-badge game-badge-${badge.variant}`}>
							{badge.label}
						</span>
					) : null;
				})()}
				<span className="game-round">{m.round}</span>
			</div>
		</div>
	);
}

export function GamesView({
	gMatches,
	kMatches,
	odds = {},
}: {
	gMatches: GroupMatch[];
	kMatches: KnockoutMatch[];
	odds?: Record<string, MatchOdds>;
}) {
	// Build sorted list of match days with their games.
	const days = useMemo<DayGroup[]>(() => {
		const all: GameMatch[] = [];

		for (const m of gMatches) {
			if (!m.date) continue;
			all.push({
				id: m.id,
				date: m.date,
				homeIdx: m.homeIdx,
				awayIdx: m.awayIdx,
				homeScore: m.homeScore,
				awayScore: m.awayScore,
				status: m.status ?? (m.played ? "finished" : "scheduled"),
				clock: m.clock ?? "",
				round: `Group ${m.group}`,
				detail: m.detail,
				winnerIdx: undefined,
			});
		}

		for (const m of kMatches) {
			if (m.homeIdx === null || m.awayIdx === null) continue;
			all.push({
				id: m.id,
				date: m.date ?? "",
				homeIdx: m.homeIdx,
				awayIdx: m.awayIdx,
				homeScore: m.homeScore,
				awayScore: m.awayScore,
				status: m.status ?? (m.played ? "finished" : "scheduled"),
				clock: m.clock ?? "",
				round: m.round,
				detail: m.detail,
				winnerIdx: m.winnerIdx,
			});
		}

		all.sort((a, b) => a.date.localeCompare(b.date));

		const byKey = new Map<string, GameMatch[]>();
		for (const m of all) {
			const k = dayKey(m.date);
			if (!k) continue;
			const arr = byKey.get(k);
			if (arr) arr.push(m);
			else byKey.set(k, [m]);
		}

		const out: DayGroup[] = [];
		for (const [k, gs] of byKey) {
			out.push({
				key: k,
				label: formatDate(gs[0].date),
				weekday: new Date(gs[0].date)
					.toLocaleDateString("en-US", { weekday: "short" })
					.toUpperCase(),
				monthDay: new Date(gs[0].date).toLocaleDateString("en-US", {
					month: "short",
					day: "numeric",
				}),
				games: gs,
			});
		}
		out.sort((a, b) => a.key.localeCompare(b.key));
		return out;
	}, [gMatches, kMatches]);

	const todayKey = dayKey(new Date().toISOString());

	// Default selection: today if it's a match day, else nearest upcoming,
	// else (everything past) the last match day.
	const defaultDay = useMemo(() => {
		if (days.length === 0) return null;
		if (days.some((d) => d.key === todayKey)) return todayKey;
		const upcoming = days.find((d) => d.key >= todayKey);
		return (upcoming ?? days[days.length - 1]).key;
	}, [days, todayKey]);

	// selected === null until the user explicitly picks a day. Display falls
	// back to defaultDay otherwise — so a reload with stale data (defaultDay
	// initially wrong, then corrected when live data lands) tracks the new
	// default instead of sticking to the stale initial value.
	const [selected, setSelected] = useState<string | null>(null);
	const pickedStillValid =
		selected !== null && days.some((d) => d.key === selected);
	const effectiveSelected = pickedStillValid ? selected : defaultDay;

	const stripRef = useRef<HTMLDivElement>(null);
	const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

	// Keep active chip in view when selection changes.
	useEffect(() => {
		const el = effectiveSelected && chipRefs.current.get(effectiveSelected);
		if (el) {
			el.scrollIntoView({
				behavior: "smooth",
				inline: "center",
				block: "nearest",
			});
		}
	}, [effectiveSelected, days]);

	const idx = days.findIndex((d) => d.key === effectiveSelected);
	const current = idx >= 0 ? days[idx] : null;

	const step = (dir: -1 | 1) => {
		if (days.length === 0) return;
		const next = Math.min(days.length - 1, Math.max(0, idx + dir));
		setSelected(days[next].key);
	};

	return (
		<div>
			<div className="section-title">Game Schedule</div>

			{days.length > 0 && (
				<div className="games-date-bar">
					<button
						type="button"
						className="games-date-arrow"
						onClick={() => step(-1)}
						disabled={idx <= 0}
						aria-label="Previous match day"
					>
						‹
					</button>
					<div className="games-date-strip" ref={stripRef}>
						{days.map((d) => {
							const isToday = d.key === todayKey;
							const isActive = d.key === effectiveSelected;
							return (
								<button
									type="button"
									key={d.key}
									ref={(el) => {
										if (el) chipRefs.current.set(d.key, el);
										else chipRefs.current.delete(d.key);
									}}
									className={`games-date-chip${isActive ? " active" : ""}${isToday ? " today" : ""}`}
									onClick={() => setSelected(d.key)}
								>
									<span className="games-date-chip-weekday">{d.weekday}</span>
									<span className="games-date-chip-date">{d.monthDay}</span>
									{isToday && <span className="games-date-chip-dot" />}
								</button>
							);
						})}
					</div>
					<button
						type="button"
						className="games-date-arrow"
						onClick={() => step(1)}
						disabled={idx < 0 || idx >= days.length - 1}
						aria-label="Next match day"
					>
						›
					</button>
				</div>
			)}

			{current ? (
				<div className={`games-day${current.key === todayKey ? " today" : ""}`}>
					<div className="games-day-header">
						{current.key === todayKey
							? `📅 ${current.label} — Today`
							: current.label}
					</div>
					{current.games.map((g) => (
						<GameRow
							key={g.id}
							m={g}
							odds={odds[oddsKey(g.homeIdx, g.awayIdx)]}
						/>
					))}
				</div>
			) : (
				<div
					style={{
						textAlign: "center",
						color: "var(--text-dim)",
						padding: "2rem",
					}}
				>
					No matches scheduled
				</div>
			)}
		</div>
	);
}
