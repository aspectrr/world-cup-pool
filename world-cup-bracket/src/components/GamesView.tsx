import { useMemo, useState, useRef, useEffect } from "react";
import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, flagUrl, shortName } from "../data/teams";
import { PLAYERS } from "../data/players";

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

function GameRow({ m }: { m: GameMatch }) {
	const home = TEAMS[m.homeIdx];
	const away = TEAMS[m.awayIdx];
	const homeOwner = teamOwner(m.homeIdx);
	const awayOwner = teamOwner(m.awayIdx);
	const isLive = m.status === "live";
	const isFinished = m.status === "finished";

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
					{homeOwner && <span className="game-owner">{homeOwner}</span>}
				</div>
				<div className="game-team">
					<div className="game-team-main">
						<img src={flagUrl(away.code)} alt={away.code} />
						<span className="game-team-name">{shortName(away.name)}</span>
					</div>
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
						<span className="game-score-num">{m.homeScore}</span>
						<span className="game-score-num">{m.awayScore}</span>
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
						{m.clock}
					</div>
				)}
				{!isLive && m.date && (
					<span className="game-time">{formatTime(m.date)}</span>
				)}
				<span className="game-round">{m.round}</span>
			</div>
		</div>
	);
}

export function GamesView({
	gMatches,
	kMatches,
}: {
	gMatches: GroupMatch[];
	kMatches: KnockoutMatch[];
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

	const [selected, setSelected] = useState<string | null>(defaultDay);
	const [lastDefault, setLastDefault] = useState<string | null>(defaultDay);

	// Sync selection to new default *during render* when the default day shifts
	// (day rolls over, data loads). Adjusting state during render is the
	// React-recommended way to avoid setState-in-effect cascading renders.
	if (defaultDay !== lastDefault) {
		setLastDefault(defaultDay);
		// Only follow the default if user hasn't manually picked a still-valid day.
		// If their pick exists in the new day list, keep it; otherwise snap to default.
		const stillExists = selected && days.some((d) => d.key === selected);
		setSelected(stillExists ? selected : defaultDay);
	}

	const stripRef = useRef<HTMLDivElement>(null);
	const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

	// Keep active chip in view when selection changes.
	useEffect(() => {
		const el = selected && chipRefs.current.get(selected);
		if (el) {
			el.scrollIntoView({
				behavior: "smooth",
				inline: "center",
				block: "nearest",
			});
		}
	}, [selected, days]);

	const idx = days.findIndex((d) => d.key === selected);
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
							const isActive = d.key === selected;
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
						<GameRow key={g.id} m={g} />
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
