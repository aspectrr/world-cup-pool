import { describe, test, expect } from "bun:test";
import {
	generateKnockoutMatches,
	R32_SLOTS,
	populateR32,
	seedLabel,
} from "./bracket";
import { generateGroupMatches } from "./bracket";
import { TEAMS } from "./teams";
import type { GroupMatch } from "../types";

describe("generateKnockoutMatches", () => {
	test("produces 16 R32 + 8 R16 + 4 QF + 2 SF + 1 Final = 31 matches", () => {
		const m = generateKnockoutMatches();
		expect(m).toHaveLength(31);
		const byRound = (r: string) => m.filter((x) => x.round === r).length;
		expect(byRound("R32")).toBe(16);
		expect(byRound("R16")).toBe(8);
		expect(byRound("QF")).toBe(4);
		expect(byRound("SF")).toBe(2);
		expect(byRound("FINAL")).toBe(1);
	});

	test("R16 feeders are consecutive R32 pairs", () => {
		const m = generateKnockoutMatches();
		const r32 = m.filter((x) => x.round === "R32");
		const r16 = m.filter((x) => x.round === "R16");
		r16.forEach((r, i) => {
			expect(r.homeSeed).toBe(`Winner ${r32[i * 2].id}`);
			expect(r.awaySeed).toBe(`Winner ${r32[i * 2 + 1].id}`);
		});
	});

	test("every R32 ID is a unique FIFA match number", () => {
		const ids = R32_SLOTS.map((s) => s.id);
		expect(new Set(ids).size).toBe(16);
		ids.forEach((id) => expect(/^M\d{2}$/.test(id)).toBe(true));
	});
});

describe("populateR32 — fixture: Netherlands vs Morocco in M75", () => {
	// Build a deterministic fake group stage where:
	//   - Group C: Brazil wins (1C), Morocco 2nd (2C)
	//   - Group F: Netherlands wins (1F), Japan 2nd (2F)
	// All other groups get a clean 1>2>3>4 ordering by groupPos so the
	// third-place ranking is well-defined. We make every group fully played.
	function buildFakeGroups(): GroupMatch[] {
		const matches = generateGroupMatches();
		// Apply a "higher groupPos wins" scoreline: groupPos 1 beats 2 beats 3 beats 4.
		// Gives: 1st = groupPos 1 (9 pts), 2nd = groupPos 2 (6), 3rd = groupPos 3 (3), 4th = groupPos 4 (0)
		return matches.map((m) => {
			const homePos = TEAMS[m.homeIdx].groupPos;
			const awayPos = TEAMS[m.awayIdx].groupPos;
			const homeScore = homePos < awayPos ? 2 : homePos > awayPos ? 0 : 1;
			const awayScore = homePos < awayPos ? 0 : homePos > awayPos ? 2 : 1;
			return { ...m, homeScore, awayScore, played: true };
		});
	}

	test("M75 is 1F (Netherlands) vs 2C (Morocco)", () => {
		const gMatches = buildFakeGroups();
		const r32 = populateR32(gMatches, new Set());
		const [home, away] = r32.get("M75")!;
		expect(TEAMS[home!].name).toBe("Netherlands");
		expect(TEAMS[away!].name).toBe("Morocco");
	});

	test("M76 is 1C (Brazil) vs 2F (Japan)", () => {
		const gMatches = buildFakeGroups();
		const r32 = populateR32(gMatches, new Set());
		const [home, away] = r32.get("M76")!;
		expect(TEAMS[home!].name).toBe("Brazil");
		expect(TEAMS[away!].name).toBe("Japan");
	});

	test("M73 is 2A (South Africa) vs 2B (Bosnia)", () => {
		const gMatches = buildFakeGroups();
		const r32 = populateR32(gMatches, new Set());
		const [home, away] = r32.get("M73")!;
		expect(TEAMS[home!].name).toBe("South Africa");
		expect(TEAMS[away!].name).toBe("Bosnia and Herzegovina");
	});

	test("M88 is 2D (Paraguay) vs 2G (Egypt)", () => {
		const gMatches = buildFakeGroups();
		const r32 = populateR32(gMatches, new Set());
		const [home, away] = r32.get("M88")!;
		expect(TEAMS[home!].name).toBe("Paraguay");
		expect(TEAMS[away!].name).toBe("Egypt");
	});

	test("all 32 advancing teams are slotted exactly once", () => {
		const gMatches = buildFakeGroups();
		const r32 = populateR32(gMatches, new Set());
		const idxs: number[] = [];
		for (const [, [h, a]] of r32) {
			if (h !== null) idxs.push(h);
			if (a !== null) idxs.push(a);
		}
		expect(idxs).toHaveLength(32);
		expect(new Set(idxs).size).toBe(32);
	});

	test("no third-placed team faces a same-group opponent", () => {
		const gMatches = buildFakeGroups();
		const r32 = populateR32(gMatches, new Set());
		for (const slot of R32_SLOTS) {
			const [h, a] = r32.get(slot.id)!;
			if (h === null || a === null) continue;
			// Annex C guarantees this for 3rd-vs-winner slots.
			expect(TEAMS[h].group).not.toBe(TEAMS[a].group);
		}
	});

	test("with no group results, every slot is null", () => {
		const empty = generateGroupMatches();
		const r32 = populateR32(empty, new Set());
		for (const [, [h, a]] of r32) {
			expect(h).toBeNull();
			expect(a).toBeNull();
		}
	});

	test("clinched winners seed early even before group stage ends", () => {
		// Build matches but mark only some as played.
		const gMatches = generateGroupMatches().map((m, i) =>
			i < 6 ? { ...m, homeScore: 3, awayScore: 0, played: true } : m,
		);
		// Mexico (idx 0) wins Group A 9pts in the first 3 group A matches if
		// they happen to be the ones marked played; regardless, clinchedWinners
		// is the explicit hint — pass idx 0.
		const r32 = populateR32(gMatches, new Set([0]));
		const m79 = r32.get("M79")!; // 1A vs 3rd
		expect(m79[0]).toBe(0); // Mexico (winner A) slotted
		expect(m79[1]).toBeNull(); // thirds can't be assigned yet
	});

	test("runner-up slots fill once that group is fully decided", () => {
		// Mark only Group C's 6 matches as played; Brazil beats everyone, Morocco
		// is runner-up. Other groups untouched.
		const gMatches = generateGroupMatches().map((m) =>
			m.group === "C"
				? { ...m, homeScore: 1, awayScore: 0, played: true }
				: m,
		);
		// Group C winner Brazil is not in clinchedWinners here, but the group is
		// decided, so 1C + 2C both populate.
		const r32 = populateR32(gMatches, new Set());
		const m76 = r32.get("M76")!; // 1C vs 2F
		expect(TEAMS[m76[0]!].name).toBe("Brazil");
		const m75 = r32.get("M75")!; // 1F vs 2C — runner-up of C
		expect(m75[1]).not.toBeNull();
		// 1F (Netherlands) shouldn't be filled yet (Group F not decided)
		expect(m75[0]).toBeNull();
	});
});

describe("seedLabel", () => {
	test("group winner → 1A", () => {
		expect(seedLabel({ kind: "1", group: "A" }, null)).toBe("1A");
	});
	test("group runner-up → 2B", () => {
		expect(seedLabel({ kind: "2", group: "B" }, null)).toBe("2B");
	});
	test("third resolved → 3F", () => {
		const spec = { kind: "3" as const, winnerKey: "1E" as const };
		expect(seedLabel(spec, "F")).toBe("3F");
	});
	test("third TBD → shows candidate groups", () => {
		const spec = { kind: "3" as const, winnerKey: "1E" as const };
		expect(seedLabel(spec, null)).toBe("3rd A/B/C/D/F");
	});
});
