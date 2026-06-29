import type { GroupMatch, GroupStanding, KnockoutMatch } from "../types";
import { TEAMS, GROUPS } from "../data/teams";

/**
 * Winner team idx of a played knockout match. Prefers ESPN's explicit
 * `winner` flag (set for ET/pen wins where regulation score is tied),
 * falls back to score difference for regulation results. Returns null for
 * unplayed/drawn matches.
 */
export function knockoutWinner(
	m: Pick<KnockoutMatch, "played" | "homeIdx" | "awayIdx" | "homeScore" | "awayScore" | "winnerIdx">,
): number | null {
	if (!m.played || m.homeScore === null || m.awayScore === null) return null;
	if (m.homeIdx === null || m.awayIdx === null) return null;
	if (m.winnerIdx !== null && m.winnerIdx !== undefined) return m.winnerIdx;
	if (m.homeScore > m.awayScore) return m.homeIdx;
	if (m.awayScore > m.homeScore) return m.awayIdx;
	return null;
}

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

/**
 * Get team indices still alive — not eliminated in knockout AND not
 * eliminated from their group.
 *
 * - While group stage is in progress: drop only teams mathematically
 *   eliminated (can't finish top-2). Third-place bubble teams stay alive
 *   since the best-8-thirds race isn't decided yet.
 * - Once group stage is done: the 32 advancing teams (top-2 of each group
 *   + best 8 thirds) are the only alive teams. Third-place teams that
 *   missed the best-8 cutoff are out.
 *
 * Then drop losers of played knockout matches in either phase.
 */
export function getAliveTeams(
	gMatches: GroupMatch[],
	kMatches: KnockoutMatch[],
): Set<number> {
	const groupStageDone =
		gMatches.length > 0 && gMatches.every((m) => m.played);

	const alive = groupStageDone
		? getAdvancingTeams(gMatches)
		: new Set(TEAMS.map((_, i) => i));

	// During group stage: drop teams mathematically eliminated (can't finish top-2)
	if (!groupStageDone) {
		for (let i = 0; i < TEAMS.length; i++) {
			if (getGroupAdvancementStatus(i, gMatches) === "eliminated") {
				alive.delete(i);
			}
		}
	}

	// Drop losers of played knockout matches
	for (const m of kMatches) {
		const w = knockoutWinner(m);
		if (w === null) continue;
		if (m.homeIdx === null || m.awayIdx === null) continue;
		alive.delete(w === m.homeIdx ? m.awayIdx : m.homeIdx);
	}
	return alive;
}

/**
 * Teams that have mathematically clinched 1st in their group — finish #1
 * in every remaining-match scenario. Used to seed R32 winner slots early.
 *
 * ponytail: same 3^N fixed-scoreline enumeration as getGroupAdvancementStatus;
 * doesn't explore every possible scoreline, so tiebreaker edge cases (GD/GF
 * swings from extreme results) can theoretically flip a result. Acceptable
 * for a pool tracker; promote to full scoreline enumeration if it misfires.
 */
export function getClinchedGroupWinners(gMatches: GroupMatch[]): Set<number> {
	const winners = new Set<number>();
	for (let i = 0; i < TEAMS.length; i++) {
		const team = TEAMS[i];
		const groupMatches = gMatches.filter((m) => m.group === team.group);
		const played = groupMatches.filter(
			(m) => m.played && m.homeScore !== null && m.awayScore !== null,
		);
		const remaining = groupMatches.filter((m) => !m.played);
		const n = remaining.length;
		const totalPerms = Math.pow(3, n);

		let clinched = true;
		for (let p = 0; p < totalPerms; p++) {
			const simMatches = [...played];
			let tmp = p;
			for (let j = 0; j < n; j++) {
				const [hs, as] = SIM_OUTCOMES[tmp % 3];
				tmp = Math.floor(tmp / 3);
				const m = remaining[j];
				simMatches.push({ ...m, played: true, homeScore: hs, awayScore: as });
			}
			const finalList = calcGroupStandings(simMatches).get(team.group) ?? [];
			const pos = finalList.findIndex((s) => s.teamIdx === i) + 1;
			if (pos !== 1) {
				clinched = false;
				break;
			}
		}
		if (clinched) winners.add(i);
	}
	return winners;
}

/** How far a team has progressed: group, r32, r16, qf, sf, final, winner */
export type Stage = "group" | "r32" | "r16" | "qf" | "sf" | "final" | "winner";

export function getTeamStage(teamIdx: number, kMatches: KnockoutMatch[]): Stage {
	// Furthest round this team reached. A team that lost in round R is
	// credited with the stage *below* R (they didn't advance past it).
	let furthest: Stage = "group";

	const WIN_STAGE: Record<string, Stage> = {
		R32: "r32",
		R16: "r16",
		QF: "qf",
		SF: "sf",
		FINAL: "winner",
	};
	const LOSE_STAGE: Record<string, Stage> = {
		R32: "group",
		R16: "r32",
		QF: "r16",
		SF: "qf",
		FINAL: "sf",
	};
	const ORDER: Stage[] = [
		"group",
		"r32",
		"r16",
		"qf",
		"sf",
		"final",
		"winner",
	];

	for (const m of kMatches) {
		if (m.homeIdx !== teamIdx && m.awayIdx !== teamIdx) continue;
		const w = knockoutWinner(m);
		if (w === null) continue; // unplayed or genuinely drawn
		const s = (w === teamIdx ? WIN_STAGE : LOSE_STAGE)[m.round] ?? "group";
		if (ORDER.indexOf(s) > ORDER.indexOf(furthest)) furthest = s;
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

/**
 * Snapshot of teams currently advancing to R32 based on live group standings.
 *
 * - Top 2 of each group (24 teams)
 * - Best 8 of the 12 third-place teams (ranked: points, GD, GF, groupPos)
 *
 * Returns the 32 team indices that would advance if the tournament
 * ended right now. Strict snapshot — does not project remaining matches.
 */
export function getAdvancingTeams(gMatches: GroupMatch[]): Set<number> {
	const computed = calcGroupStandings(gMatches);
	const advancing = new Set<number>();
	const thirds: GroupStanding[] = [];

	for (const group of GROUPS) {
		const idxs = TEAMS.map((t, i) => ({ ...t, idx: i }))
			.filter((t) => t.group === group)
			.map((t) => t.idx);

		const rows = idxs.map((idx) => {
			const found = computed.get(group)?.find((s) => s.teamIdx === idx);
			return (
				found ?? {
					teamIdx: idx,
					played: 0,
					won: 0,
					drawn: 0,
					lost: 0,
					gf: 0,
					ga: 0,
					points: 0,
				}
			);
		});
		rows.sort(compareStandings);

		if (rows[0]) advancing.add(rows[0].teamIdx);
		if (rows[1]) advancing.add(rows[1].teamIdx);
		if (rows[2]) thirds.push(rows[2]);
	}

	// Rank third-place teams: points, GD, GF, then groupPos
	thirds.sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		const gdA = a.gf - a.ga;
		const gdB = b.gf - b.ga;
		if (gdB !== gdA) return gdB - gdA;
		if (b.gf !== a.gf) return b.gf - a.gf;
		return TEAMS[a.teamIdx].groupPos - TEAMS[b.teamIdx].groupPos;
	});

	for (let i = 0; i < Math.min(8, thirds.length); i++) {
		advancing.add(thirds[i].teamIdx);
	}

	return advancing;
}
