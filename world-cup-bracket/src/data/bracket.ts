import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, GROUPS } from "./teams";

function groupTeamIndices(group: string): number[] {
	return TEAMS.map((t, i) => ({ ...t, idx: i }))
		.filter((t) => t.group === group)
		.sort((a, b) => a.groupPos - b.groupPos)
		.map((t) => t.idx);
}

export function generateGroupMatches(): GroupMatch[] {
	const matches: GroupMatch[] = [];
	let id = 0;

	for (const group of GROUPS) {
		const teams = groupTeamIndices(group);
		// Matchday 1: 1v2, 3v4
		matches.push({
			id: `G${id++}`,
			group,
			round: 1,
			homeIdx: teams[0],
			awayIdx: teams[1],
			homeScore: null,
			awayScore: null,
			played: false,
		});
		matches.push({
			id: `G${id++}`,
			group,
			round: 1,
			homeIdx: teams[3],
			awayIdx: teams[2],
			homeScore: null,
			awayScore: null,
			played: false,
		});
		// Matchday 2: 1v3, 2v4
		matches.push({
			id: `G${id++}`,
			group,
			round: 2,
			homeIdx: teams[0],
			awayIdx: teams[2],
			homeScore: null,
			awayScore: null,
			played: false,
		});
		matches.push({
			id: `G${id++}`,
			group,
			round: 2,
			homeIdx: teams[3],
			awayIdx: teams[1],
			homeScore: null,
			awayScore: null,
			played: false,
		});
		// Matchday 3: 1v4, 2v3
		matches.push({
			id: `G${id++}`,
			group,
			round: 3,
			homeIdx: teams[0],
			awayIdx: teams[3],
			homeScore: null,
			awayScore: null,
			played: false,
		});
		matches.push({
			id: `G${id++}`,
			group,
			round: 3,
			homeIdx: teams[1],
			awayIdx: teams[2],
			homeScore: null,
			awayScore: null,
			played: false,
		});
	}

	return matches;
}

// Generate knockout bracket skeleton: R32(16) → R16(8) → QF(4) → SF(2) → FINAL(1)
export function generateKnockoutMatches(): KnockoutMatch[] {
	const matches: KnockoutMatch[] = [];

	// R32 (16 matches)
	for (let i = 0; i < 16; i++) {
		matches.push({
			id: `R32-${i + 1}`,
			round: "R32",
			homeIdx: null,
			awayIdx: null,
			homeScore: null,
			awayScore: null,
			played: false,
			homeSeed: `R32-${i + 1}H`,
			awaySeed: `R32-${i + 1}A`,
		});
	}

	// R16: winner of R32-1 vs R32-2, R32-3 vs R32-4, etc.
	for (let i = 0; i < 8; i++) {
		matches.push({
			id: `R16-${i + 1}`,
			round: "R16",
			homeIdx: null,
			awayIdx: null,
			homeScore: null,
			awayScore: null,
			played: false,
			homeSeed: `W:${matches[i * 2].id}`,
			awaySeed: `W:${matches[i * 2 + 1].id}`,
		});
	}

	// QF
	for (let i = 0; i < 4; i++) {
		matches.push({
			id: `QF-${i + 1}`,
			round: "QF",
			homeIdx: null,
			awayIdx: null,
			homeScore: null,
			awayScore: null,
			played: false,
			homeSeed: `W:${matches[16 + i * 2].id}`,
			awaySeed: `W:${matches[16 + i * 2 + 1].id}`,
		});
	}

	// SF
	for (let i = 0; i < 2; i++) {
		matches.push({
			id: `SF-${i + 1}`,
			round: "SF",
			homeIdx: null,
			awayIdx: null,
			homeScore: null,
			awayScore: null,
			played: false,
			homeSeed: `W:${matches[24 + i * 2].id}`,
			awaySeed: `W:${matches[24 + i * 2 + 1].id}`,
		});
	}

	// FINAL
	matches.push({
		id: "FINAL",
		round: "FINAL",
		homeIdx: null,
		awayIdx: null,
		homeScore: null,
		awayScore: null,
		played: false,
		homeSeed: `W:${matches[28].id}`,
		awaySeed: `W:${matches[29].id}`,
	});

	return matches;
}

export function getGroupTeams(group: string): number[] {
	return groupTeamIndices(group);
}
