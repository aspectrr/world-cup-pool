import type { GroupMatch, KnockoutMatch } from "../types";
import { TEAMS, GROUPS } from "./teams";
import { ANNEX_C, WINNER_SLOTS } from "./annexc";
import { calcGroupStandings } from "../utils/standings";

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

// ── FIFA World Cup 2026 knockout bracket structure ───────────────────
//
// The 16 R32 ties and their feeders are fixed by FIFA; the R16/QF/SF/Final
// pairing is also fixed. Source: FIFA Competition Regulations + wikipedia
// 2026_FIFA_World_Cup_knockout_stage.
//
// R32 match IDs are FIFA's (M73..M88). Ordering within the array is chosen
// so the bracket reads top→bottom on the page AND each consecutive pair of
// R32 matches feeds a single R16 match (so R16[n] = winner(R32[2n]) vs
// winner(R32[2n+1])). QF/SF/Final then chain the same way.

export type WinnerKey = (typeof WINNER_SLOTS)[number];

/** Where a knockout slot's team comes from, described structurally. */
export type SeedSpec =
	| { kind: "1"; group: string } // group winner (e.g. 1A)
	| { kind: "2"; group: string } // group runner-up (e.g. 2B)
	| { kind: "3"; winnerKey: WinnerKey }; // best third, slotted via Annex C

export interface R32Slot {
	/** FIFA match ID, e.g. "M74". */
	id: string;
	home: SeedSpec;
	away: SeedSpec;
}

/**
 * Ordered R32 slots. Order is chosen so:
 *   - consecutive pairs feed R16 (R16[n] = W{R32[2n]} vs W{R32[2n+1]})
 *   - which then chains correctly into QF / SF / Final per FIFA pairings
 *
 * Mapping derived from FIFA R16 schedule:
 *   M89 = W M74 vs W M77    M93 = W M83 vs W M84
 *   M90 = W M73 vs W M75    M94 = W M81 vs W M82
 *   M91 = W M76 vs W M78    M95 = W M86 vs W M88
 *   M92 = W M79 vs W M80    M96 = W M85 vs W M87
 *   QF: M97=M89+M90, M98=M93+M94, M99=M91+M92, M100=M95+M96
 *   SF: M101=M97+M98, M102=M99+M100
 *   F:  W M101 vs W M102
 */
export const R32_SLOTS: R32Slot[] = [
	{ id: "M74", home: { kind: "1", group: "E" }, away: { kind: "3", winnerKey: "1E" } }, // Germany vs 3rd
	{ id: "M77", home: { kind: "1", group: "I" }, away: { kind: "3", winnerKey: "1I" } }, // 1I vs 3rd
	{ id: "M73", home: { kind: "2", group: "A" }, away: { kind: "2", group: "B" } }, // 2A vs 2B
	{ id: "M75", home: { kind: "1", group: "F" }, away: { kind: "2", group: "C" } }, // 1F vs 2C (NED vs MAR)
	{ id: "M83", home: { kind: "2", group: "K" }, away: { kind: "2", group: "L" } }, // 2K vs 2L
	{ id: "M84", home: { kind: "1", group: "H" }, away: { kind: "2", group: "J" } }, // 1H vs 2J
	{ id: "M81", home: { kind: "1", group: "D" }, away: { kind: "3", winnerKey: "1D" } }, // USA vs 3rd
	{ id: "M82", home: { kind: "1", group: "G" }, away: { kind: "3", winnerKey: "1G" } }, // 1G vs 3rd
	{ id: "M76", home: { kind: "1", group: "C" }, away: { kind: "2", group: "F" } }, // 1C vs 2F (BRA vs JPN)
	{ id: "M78", home: { kind: "2", group: "E" }, away: { kind: "2", group: "I" } }, // 2E vs 2I
	{ id: "M79", home: { kind: "1", group: "A" }, away: { kind: "3", winnerKey: "1A" } }, // Mexico vs 3rd
	{ id: "M80", home: { kind: "1", group: "L" }, away: { kind: "3", winnerKey: "1L" } }, // 1L vs 3rd
	{ id: "M86", home: { kind: "1", group: "J" }, away: { kind: "2", group: "H" } }, // ARG vs 2H
	{ id: "M88", home: { kind: "2", group: "D" }, away: { kind: "2", group: "G" } }, // 2D vs 2G
	{ id: "M85", home: { kind: "1", group: "B" }, away: { kind: "3", winnerKey: "1B" } }, // SUI vs 3rd
	{ id: "M87", home: { kind: "1", group: "K" }, away: { kind: "3", winnerKey: "1K" } }, // 1K vs 3rd
];

/** Build the empty R32→Final skeleton with FIFA IDs and feeders. */
export function generateKnockoutMatches(): KnockoutMatch[] {
	const matches: KnockoutMatch[] = [];

	// R32
	for (const slot of R32_SLOTS) {
		matches.push({
			id: slot.id,
			round: "R32",
			homeIdx: null,
			awayIdx: null,
			homeScore: null,
			awayScore: null,
			played: false,
			homeSeed: seedLabel(slot.home, null),
			awaySeed: seedLabel(slot.away, null),
		});
	}

	const r32Start = 0;

	// R16: each consecutive R32 pair feeds one R16 match
	for (let i = 0; i < 8; i++) {
		const a = matches[r32Start + i * 2];
		const b = matches[r32Start + i * 2 + 1];
		matches.push({
			id: `M${89 + i}`,
			round: "R16",
			homeIdx: null,
			awayIdx: null,
			homeScore: null,
			awayScore: null,
			played: false,
			homeSeed: `Winner ${a.id}`,
			awaySeed: `Winner ${b.id}`,
		});
	}

	const r16Start = 16;
	// QF
	for (let i = 0; i < 4; i++) {
		const a = matches[r16Start + i * 2];
		const b = matches[r16Start + i * 2 + 1];
		matches.push({
			id: `M${97 + i}`,
			round: "QF",
			homeIdx: null,
			awayIdx: null,
			homeScore: null,
			awayScore: null,
			played: false,
			homeSeed: `Winner ${a.id}`,
			awaySeed: `Winner ${b.id}`,
		});
	}

	const qfStart = 24;
	// SF
	for (let i = 0; i < 2; i++) {
		const a = matches[qfStart + i * 2];
		const b = matches[qfStart + i * 2 + 1];
		matches.push({
			id: `M${101 + i}`,
			round: "SF",
			homeIdx: null,
			awayIdx: null,
			homeScore: null,
			awayScore: null,
			played: false,
			homeSeed: `Winner ${a.id}`,
			awaySeed: `Winner ${b.id}`,
		});
	}

	const sfStart = 28;
	// Final
	matches.push({
		id: "M104",
		round: "FINAL",
		homeIdx: null,
		awayIdx: null,
		homeScore: null,
		awayScore: null,
		played: false,
		homeSeed: `Winner ${matches[sfStart].id}`,
		awaySeed: `Winner ${matches[sfStart + 1].id}`,
	});

	return matches;
}

/**
 * Human-readable label for a slot while it's still TBD.
 *
 * - `1A`/`2B` — group position + group letter
 * - `3rd` — third-place team; once Annex C assigns a group, shows `3C`,
 *   otherwise shows the candidate group set (e.g. `3rd A/B/C/D/F`)
 */
export function seedLabel(spec: SeedSpec, thirdGroup: string | null): string {
	if (spec.kind === "1") return `1${spec.group}`;
	if (spec.kind === "2") return `2${spec.group}`;
	if (thirdGroup) return `3${thirdGroup}`;
	return `3rd ${thirdCandidates(spec.winnerKey).join("/")}`;
}

/** Groups that could possibly feed a given winner-key's third-place slot. */
export function thirdCandidates(winnerKey: WinnerKey): string[] {
	// Pre-published candidate sets per FIFA R32 schedule.
	const CANDIDATES: Record<WinnerKey, string[]> = {
		"1A": ["C", "E", "F", "H", "I"],
		"1B": ["E", "F", "G", "I", "J"],
		"1D": ["B", "E", "F", "I", "J"],
		"1E": ["A", "B", "C", "D", "F"],
		"1G": ["A", "E", "H", "I", "J"],
		"1I": ["C", "D", "F", "G", "H"],
		"1K": ["D", "E", "I", "J", "L"],
		"1L": ["E", "H", "I", "J", "K"],
	};
	return CANDIDATES[winnerKey];
}

/**
 * Compute R32 home/away team indices per match ID, given live group results.
 *
 * Returns a Map keyed by R32 match ID (e.g. "M75") with `[homeIdx, awayIdx]`,
 * where either slot may be `null` if not yet determined.
 *
 * - Group winners / runners-up: filled once decided (clinched or all played).
 * - Third-place slots: only filled once every group is fully decided, since
 *   the Annex C lookup needs the final set of 8 qualifying thirds.
 *
 * `clinchedWinners` lets us seed winner slots before the group stage ends.
 */
export function populateR32(
	gMatches: GroupMatch[],
	clinchedWinners: Set<number>,
): Map<string, [number | null, number | null]> {
	const standings = calcGroupStandings(gMatches);

	const allGroupPlayed =
		gMatches.length > 0 && gMatches.every((m) => m.played);

	// A group is "decided" once all 6 of its matches are played. We need this
	// per-group because runner-up / 3rd aren't safe until the group is done.
	const groupDecided = new Map<string, boolean>();
	for (const g of GROUPS) {
		const played = gMatches.filter((m) => m.group === g && m.played).length;
		groupDecided.set(g, played === 6);
	}

	const winners: Record<string, number | null> = {};
	const runners: Record<string, number | null> = {};
	const thirds: { group: string; idx: number; points: number; gd: number; gf: number }[] = [];

	for (const g of GROUPS) {
		const gs = standings.get(g) ?? [];
		const w = gs[0]?.teamIdx ?? null;
		const decided = groupDecided.get(g) ?? false;
		// Winner slot: fill once clinched OR group fully decided.
		winners[g] =
			w !== null && (clinchedWinners.has(w) || decided || allGroupPlayed)
				? w
				: null;
		// Runner-up: fill once this group is decided (don't need every group).
		runners[g] = decided || allGroupPlayed ? (gs[1]?.teamIdx ?? null) : null;
		if (allGroupPlayed && gs[2]) {
			thirds.push({
				group: g,
				idx: gs[2].teamIdx,
				points: gs[2].points,
				gd: gs[2].gf - gs[2].ga,
				gf: gs[2].gf,
			});
		}
	}

	// Rank third-place teams: points, GD, GF, then preset groupPos (stable).
	thirds.sort(
		(a, b) =>
			b.points - a.points ||
			b.gd - a.gd ||
			b.gf - a.gf ||
			TEAMS[a.idx].groupPos - TEAMS[b.idx].groupPos,
	);
	const bestThirds = thirds.slice(0, 8);

	// Annex C lookup: needs the sorted set of qualifying third-groups.
	const thirdsKey = bestThirds.map((t) => t.group).sort().join("-");
	const annex = ANNEX_C[thirdsKey];
	const thirdByGroup = new Map(bestThirds.map((t) => [t.group, t.idx]));
	// Map winnerKey → third-group (only valid once annex resolved)
	const winnerKeyToThirdGroup = new Map<WinnerKey, string>();
	if (annex) {
		WINNER_SLOTS.forEach((wk, i) => {
			winnerKeyToThirdGroup.set(wk, annex[i]);
		});
	}

	const resolveSpec = (spec: SeedSpec): number | null => {
		if (spec.kind === "1") return winners[spec.group] ?? null;
		if (spec.kind === "2") return runners[spec.group] ?? null;
		// third
		if (!annex) return null;
		const g = winnerKeyToThirdGroup.get(spec.winnerKey);
		if (!g) return null;
		return thirdByGroup.get(g) ?? null;
	};

	const out = new Map<string, [number | null, number | null]>();
	for (const slot of R32_SLOTS) {
		out.set(slot.id, [resolveSpec(slot.home), resolveSpec(slot.away)]);
	}
	return out;
}

export function getGroupTeams(group: string): number[] {
	return groupTeamIndices(group);
}
