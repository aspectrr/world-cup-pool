/**
 * Pure schedule-building logic for the Games tab.
 *
 * Extracted from GamesView so the day-grouping, synthetic "today" chip, and
 * "next game" computation are unit-testable without a DOM testing library.
 */
import type { GroupMatch, KnockoutMatch } from "../types";

export interface GameMatch {
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

export interface DayGroup {
	key: string; // YYYY-MM-DD (local)
	label: string; // "Thu, Jun 11"
	weekday: string; // "THU"
	monthDay: string; // "Jun 11"
	games: GameMatch[];
}

/** Next scheduled fixture after now — drives the "no games today" message. */
export interface NextGame {
	date: string;
	homeIdx: number | null;
	awayIdx: number | null;
	round: string;
}

/** Local-day key from ISO string (so grouping matches user's calendar). */
export function dayKey(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate(),
	).padStart(2, "0")}`;
}

export function formatDate(iso: string): string {
	if (!iso) return "TBD";
	const d = new Date(iso);
	return d.toLocaleDateString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
	});
}

export function formatTime(iso: string): string {
	if (!iso) return "";
	const d = new Date(iso);
	return d.toLocaleTimeString("en-US", {
		hour: "numeric",
		minute: "2-digit",
	});
}

/** Human-readable round name for the "next game" callout. */
export function roundLabel(round: string): string {
	switch (round) {
		case "R32":
			return "Round of 32";
		case "R16":
			return "Round of 16";
		case "QF":
			return "Quarter-final";
		case "SF":
			return "Semi-final";
		case "FINAL":
			return "Final";
		case "THIRD":
			return "Third-place play-off";
		default:
			return round; // "Group A" etc.
	}
}

/**
 * Build the sorted list of match days plus the next upcoming fixture.
 *
 * A synthetic empty entry for `todayKey` is inserted when today has no
 * games, so the date bar shows today's date with a "no games today" empty
 * state instead of jumping to the next match day.
 */
export function buildScheduleDays(
	gMatches: GroupMatch[],
	kMatches: KnockoutMatch[],
	todayKey: string,
	now: Date,
): { days: DayGroup[]; nextGame: NextGame | null } {
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

	// Next upcoming fixture from now (earliest non-finished game in
	// the future) — drives the "no games today" empty-state message.
	let nextGame: NextGame | null = null;
	for (const m of all) {
		if (m.date && new Date(m.date) > now && m.status !== "finished") {
			nextGame = {
				date: m.date,
				homeIdx: m.homeIdx,
				awayIdx: m.awayIdx,
				round: m.round,
			};
			break;
		}
	}

	const byKey = new Map<string, GameMatch[]>();
	for (const m of all) {
		const k = dayKey(m.date);
		if (!k) continue;
		const arr = byKey.get(k);
		if (arr) arr.push(m);
		else byKey.set(k, [m]);
	}

	// Synthetic "today" chip when the current day has no games, so the
	// bar shows today's date with an empty state instead of jumping to
	// the next match day.
	if (todayKey && !byKey.has(todayKey)) byKey.set(todayKey, []);

	const out: DayGroup[] = [];
	for (const [k, gs] of byKey) {
		const refIso = gs[0]?.date ?? now.toISOString();
		out.push({
			key: k,
			label: formatDate(refIso),
			weekday: new Date(refIso)
				.toLocaleDateString("en-US", { weekday: "short" })
				.toUpperCase(),
			monthDay: new Date(refIso).toLocaleDateString("en-US", {
				month: "short",
				day: "numeric",
			}),
			games: gs,
		});
	}
	out.sort((a, b) => a.key.localeCompare(b.key));
	return { days: out, nextGame };
}
