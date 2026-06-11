import type { GroupMatch, GroupStanding } from "../types";
import { TEAMS } from "../data/teams";

/** Calculate group standings from played matches */
export function calcGroupStandings(
	matches: GroupMatch[],
): Map<string, GroupStanding[]> {
	const map = new Map<string, GroupStanding[]>();

	for (const m of matches) {
		if (!m.played || m.homeScore === null || m.awayScore === null) continue;

		for (const idx of [m.homeIdx, m.awayIdx]) {
			if (!map.has(TEAMS[idx].group)) {
				map.set(TEAMS[idx].group, []);
			}
		}

		const standings = map.get(TEAMS[m.homeIdx].group)!;

		const ensure = (idx: number) => {
			let s = standings.find((x) => x.teamIdx === idx);
			if (!s) {
				s = {
					teamIdx: idx,
					played: 0,
					won: 0,
					drawn: 0,
					lost: 0,
					gf: 0,
					ga: 0,
					points: 0,
				};
				standings.push(s);
			}
			return s;
		};

		const home = ensure(m.homeIdx);
		const away = ensure(m.awayIdx);

		home.played++;
		away.played++;
		home.gf += m.homeScore;
		home.ga += m.awayScore;
		away.gf += m.awayScore;
		away.ga += m.homeScore;

		if (m.homeScore > m.awayScore) {
			home.won++;
			home.points += 3;
			away.lost++;
		} else if (m.homeScore < m.awayScore) {
			away.won++;
			away.points += 3;
			home.lost++;
		} else {
			home.drawn++;
			away.drawn++;
			home.points++;
			away.points++;
		}
	}

	// Sort each group: points, GD, GF
	for (const [, standings] of map) {
		standings.sort((a, b) => {
			if (b.points !== a.points) return b.points - a.points;
			const gdA = a.gf - a.ga;
			const gdB = b.gf - b.ga;
			if (gdB !== gdA) return gdB - gdA;
			return b.gf - a.gf;
		});
	}

	return map;
}

/** Get team indices still alive (not eliminated in knockout) */
export function getAliveTeams(
	_gMatches: GroupMatch[],
	kMatches: {
		played: boolean;
		homeIdx: number | null;
		awayIdx: number | null;
		homeScore: number | null;
		awayScore: number | null;
	}[],
): Set<number> {
	// If no knockout matches played, all teams are alive
	const anyKnockoutPlayed = kMatches.some((m) => m.played);
	if (!anyKnockoutPlayed) return new Set(TEAMS.map((_, i) => i));

	// Start with all teams, remove losers of played knockout matches
	const alive = new Set(TEAMS.map((_, i) => i));
	for (const m of kMatches) {
		if (!m.played || m.homeScore === null || m.awayScore === null) continue;
		if (m.homeIdx === null || m.awayIdx === null) continue;

		if (m.homeScore > m.awayScore) {
			alive.delete(m.awayIdx);
		} else if (m.awayScore > m.homeScore) {
			alive.delete(m.homeIdx);
		}
	}
	return alive;
}

/** How far a team has progressed: group, r32, r16, qf, sf, final, winner */
export type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "winner";

export function getTeamStage(
	teamIdx: number,
	kMatches: {
		round: string;
		played: boolean;
		homeIdx: number | null;
		awayIdx: number | null;
		homeScore: number | null;
		awayScore: number | null;
	}[],
): Stage {
	// Find furthest round where this team won
	let furthest: Stage = "group";

	for (const m of kMatches) {
		if (!m.played || m.homeScore === null || m.awayScore === null) continue;
		if (m.homeIdx !== teamIdx && m.awayIdx !== teamIdx) continue;

		const won =
			(m.homeIdx === teamIdx && m.homeScore > m.awayScore) ||
			(m.awayIdx === teamIdx && m.awayScore > m.homeScore);

		if (won) {
			const stageMap: Record<string, Stage> = {
				R32: "r32",
				R16: "r16",
				QF: "qf",
				SF: "sf",
				FINAL: "winner",
			};
			const s = stageMap[m.round] ?? "group";
			const order: Stage[] = [
				"group",
				"r32",
				"r16",
				"qf",
				"sf",
				"final",
				"winner",
			];
			if (order.indexOf(s) > order.indexOf(furthest)) {
				furthest = s;
			}
		} else {
			// Lost — they're eliminated at this round
			const stageMap: Record<string, Stage> = {
				R32: "group",
				R16: "r32",
				QF: "r16",
				SF: "qf",
				FINAL: "sf",
			};
			const s = stageMap[m.round] ?? "group";
			const order: Stage[] = [
				"group",
				"r32",
				"r16",
				"qf",
				"sf",
				"final",
				"winner",
			];
			if (order.indexOf(s) > order.indexOf(furthest)) {
				furthest = s;
			}
		}
	}

	return furthest;
}
