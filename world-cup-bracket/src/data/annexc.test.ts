import { describe, test, expect } from "bun:test";
import { ANNEX_C, WINNER_SLOTS } from "./annexc";

describe("ANNEX_C", () => {
	test("has exactly 495 combinations", () => {
		expect(Object.keys(ANNEX_C).length).toBe(495);
	});

	test("every key is 8 distinct sorted groups A-L", () => {
		const valid = new Set("ABCDEFGHIJKL".split(""));
		for (const key of Object.keys(ANNEX_C)) {
			const groups = key.split("-");
			expect(groups).toHaveLength(8);
			expect(new Set(groups).size).toBe(8);
			groups.forEach((g) => expect(valid.has(g)).toBe(true));
			// sorted
			expect([...groups].sort().join("-")).toBe(key);
		}
	});

	test("every value assigns one third to each winner slot, no same-group", () => {
		for (const [key, assignment] of Object.entries(ANNEX_C)) {
			expect(assignment).toHaveLength(8);
			const thirds = new Set(key.split("-"));
			// every assigned group is in the qualifying set
			assignment.forEach((g) => expect(thirds.has(g)).toBe(true));
			// each winner slot's group is not its own (no 1A vs 3A)
			WINNER_SLOTS.forEach((wk, i) => {
				expect(assignment[i]).not.toBe(wk[1]);
			});
			// 8 distinct thirds assigned
			expect(new Set(assignment).size).toBe(8);
		}
	});

	test("all 495 combos of 8-of-12 are present", () => {
		// C(12,8) = 495
		const letters = "ABCDEFGHIJKL".split("");
		const seen = new Set(Object.keys(ANNEX_C));
		let expected = 0;
		const rec = (start: number, acc: string[]) => {
			if (acc.length === 8) {
				expected++;
				expect(seen.has(acc.join("-"))).toBe(true);
				return;
			}
			for (let i = start; i < letters.length; i++) {
				rec(i + 1, [...acc, letters[i]]);
			}
		};
		rec(0, []);
		expect(expected).toBe(495);
	});
});
