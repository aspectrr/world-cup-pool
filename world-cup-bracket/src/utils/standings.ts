import type { GroupMatch, GroupStanding } from "../types";
import { TEAMS } from "../data/teams";

/** Compare two standings rows: points, GD, GF, then preset groupPos */
function compareStandings(a: GroupStanding, b: GroupStanding): number {
	if (b.points !== a.points) return b.points - a.points;
	const gdA = a.gf - a.ga;
	const gdB = b.gf - b.ga;
	if (gdB !== gdA) return gdB - gdA;
	if (b.gf !== a.gf) return b.gf - a.gf;
	return TEAMS[a.teamIdx].groupPos - TEAMS[b.teamIdx].groupPos;
}

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

	// Sort each group: points, GD, GF, then preset groupPos
	for (const [, standings] of map) {
		standings.sort(compareStandings);
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

export type AdvancementStatus = "clinched" | "bubble" | "atRisk" | "eliminated";

// Possible simulated scorelines for an unplayed match: home win / draw / away win
const SIM_OUTCOMES: Array<[number, number]> = [
	[2, 0],
	[1, 1],
	[0, 2],
];

/**
 * Deterministic group advancement status for a team.
 *
 * Enumerates every outcome (3^N) of the group's remaining matches and derives:
 * - clinched: finishes top-2 in every scenario
 * - eliminated: best possible finish is 4th (no best-3rd shot either)
 * - bubble: currently sitting 3rd (best-3rd race)
 * - atRisk: everything else (could climb or drop)
 *
 * Strict top-2 model — does not simulate cross-group best-3rd comparison.
 */
export function getGroupAdvancementStatus(
	teamIdx: number,
	gMatches: GroupMatch[],
): AdvancementStatus {
	const team = TEAMS[teamIdx];
	const groupTeams = TEAMS.map((t, i) => ({ ...t, idx: i }))
		.filter((t) => t.group === team.group)
		.map((t) => t.idx);

	const groupMatches = gMatches.filter((m) => m.group === team.group);
	const played = groupMatches.filter(
		(m) => m.played && m.homeScore !== null && m.awayScore !== null,
	);
	const remaining = groupMatches.filter((m) => !m.played);

	const zero = (idx: number): GroupStanding => ({
		teamIdx: idx,
		played: 0,
		won: 0,
		drawn: 0,
		lost: 0,
		gf: 0,
		ga: 0,
		points: 0,
	});

	// Current live position (with zero-fill for unplayed teams)
	const currentMap = calcGroupStandings(played).get(team.group) ?? [];
	const currentList = groupTeams.map(
		(idx) => currentMap.find((s) => s.teamIdx === idx) ?? zero(idx),
	);
	const currentPos =
		[...currentList]
			.sort(compareStandings)
			.findIndex((s) => s.teamIdx === teamIdx) + 1;

	// Enumerate all remaining-match outcomes (3^N permutations)
	const n = remaining.length;
	const totalPerms = Math.pow(3, n);

	let alwaysTop2 = true;
	let bestPos = 4;

	for (let p = 0; p < totalPerms; p++) {
		const simMatches = [...played];
		let tmp = p;
		for (let i = 0; i < n; i++) {
			const [hs, as] = SIM_OUTCOMES[tmp % 3];
			tmp = Math.floor(tmp / 3);
			const m = remaining[i];
			simMatches.push({ ...m, played: true, homeScore: hs, awayScore: as });
		}

		const finalList = calcGroupStandings(simMatches).get(team.group) ?? [];
		const pos = finalList.findIndex((s) => s.teamIdx === teamIdx) + 1;

		if (pos > 2) alwaysTop2 = false;
		if (pos < bestPos) bestPos = pos;
	}

	if (alwaysTop2) return "clinched";
	if (bestPos === 4) return "eliminated";
	if (currentPos === 3) return "bubble";
	return "atRisk";
}
