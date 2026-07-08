import { describe, test, expect } from "bun:test";
import { PLAYERS, teamOwner } from "./players";
import { TEAMS } from "./teams";

describe("teamOwner", () => {
	test("resolves a drafted team to its pool player", () => {
		// Collin's teams: [47, 10, 20, 6, 18, 32]
		expect(teamOwner(47)).toBe("Collin");
		expect(teamOwner(10)).toBe("Collin");
		// Frank's teams: [2, 29, 17, 9, 44, 24]
		expect(teamOwner(2)).toBe("Frank");
		expect(teamOwner(24)).toBe("Frank");
	});

	test("returns null for an unowned team index", () => {
		expect(teamOwner(99)).toBeNull();
	});

	test("every WC team is owned by exactly one pool player", () => {
		// The empty-state "next up" card shows each team's owner in gold —
		// guard the invariant that every team resolves to a player.
		for (let i = 0; i < TEAMS.length; i++) {
			expect(teamOwner(i)).not.toBeNull();
		}
	});

	test("no team is owned by two players", () => {
		const owners: string[] = [];
		for (let i = 0; i < TEAMS.length; i++) {
			const matches = PLAYERS.filter((p) => p.teamIndices.includes(i));
			expect(matches).toHaveLength(1);
			owners.push(matches[0].name);
		}
		// 48 distinct teams → 48 owner slots, 6 per player × 8 players.
		expect(owners).toHaveLength(48);
		expect(new Set(owners).size).toBe(8);
	});

	test("each pool player drafted exactly 6 teams", () => {
		for (const p of PLAYERS) {
			expect(p.teamIndices).toHaveLength(6);
			// no duplicate picks within a player's own stable
			expect(new Set(p.teamIndices).size).toBe(6);
		}
	});
});
