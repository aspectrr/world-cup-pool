import { useMemo } from "react";
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
	const gamesByDay = useMemo(() => {
		const all: GameMatch[] = [];

		for (const m of gMatches) {
			if (!m.date) continue; // skip if no schedule date
			all.push({
				id: m.id,
				date: m.date ?? "",
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
				status: m.played ? "finished" : "scheduled",
				clock: "",
				round: m.round,
			});
		}

		// Sort by date
		all.sort((a, b) => a.date.localeCompare(b.date));

		// Group by day
		const days: Record<string, GameMatch[]> = {};
		for (const m of all) {
			const day = m.date ? formatDate(m.date) : "Schedule TBD";
			if (!days[day]) days[day] = [];
			days[day].push(m);
		}

		return days;
	}, [gMatches, kMatches]);

	// Find today's date key for auto-scroll
	const todayKey = formatDate(new Date().toISOString());

	return (
		<div>
			<div className="section-title">Game Schedule</div>
			{Object.entries(gamesByDay).map(([day, games]) => (
				<div
					key={day}
					className={`games-day${day === todayKey ? " today" : ""}`}
				>
					<div className="games-day-header">
						{day === todayKey ? `📅 ${day} — Today` : day}
					</div>
					{games.map((g) => (
						<GameRow key={g.id} m={g} />
					))}
				</div>
			))}
			{Object.keys(gamesByDay).length === 0 && (
				<div style={{ textAlign: "center", color: "var(--text-dim)", padding: "2rem" }}>
					No matches scheduled
				</div>
			)}
		</div>
	);
}
