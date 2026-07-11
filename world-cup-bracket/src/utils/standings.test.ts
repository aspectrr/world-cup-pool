import { describe, test, expect } from "bun:test";
import { generateGroupMatches } from "../data/bracket";
import { TEAMS } from "../data/teams";
import type { GroupMatch, KnockoutMatch } from "../types";
import {
	calcGroupStandings,
	getGroupAdvancementStatus,
	isFinal,
	knockoutWinner,
} from "./standings";

describe("isFinal", () => {
	test("finished is final; live and scheduled are not", () => {
		expect(isFinal({ played: true, status: "finished" })).toBe(true);
		expect(isFinal({ played: true, status: "live" })).toBe(false);
		expect(isFinal({ played: false, status: "scheduled" })).toBe(false);
		// Defensive: a played match with no status is treated as final —
		// preserves fixtures that set `played: true` without an explicit status.
		expect(isFinal({ played: true })).toBe(true);
	});
});

// The whole point of the finalized-results change: an in-progress game must
// NOT move the standings. Live score still shows in Games/Bracket (which key
// off `played` + `status`), but points/GD/advancement ignore it until "FT".
describe("standings ignore live games", () => {
	// Team 0's group + its 3 round-robin matches. Force team 0 to a 3-0 win
	// in every one of its matches, under whichever status we pass in.
	const GROUP = TEAMS[0].group;
	const team0Matches = generateGroupMatches().filter(
		(m) => m.group === GROUP && (m.homeIdx === 0 || m.awayIdx === 0),
	);

	function team0Wins(status: "live" | "finished"): GroupMatch[] {
		return team0Matches.map((m) => {
			const team0Home = m.homeIdx === 0;
			return {
				...m,
				homeScore: team0Home ? 3 : 0,
				awayScore: team0Home ? 0 : 3,
				played: true,
				status,
			};
		});
	}

	test("calcGroupStandings counts finished results", () => {
		const map = calcGroupStandings(team0Wins("finished"));
		const team0 = map.get(GROUP)!.find((s) => s.teamIdx === 0)!;
		expect(team0.won).toBe(3);
		expect(team0.points).toBe(9);
		expect(team0.gf).toBe(9);
	});

	test("calcGroupStandings skips live results entirely", () => {
		const map = calcGroupStandings(team0Wins("live"));
		// No finalized matches in this group → group isn't even present.
		expect(map.has(GROUP)).toBe(false);
	});

	test("a finished win clinches; the same games live do NOT", () => {
		// 9 finalized pts with every other group match still to play →
		// guaranteed 1st, so "clinched".
		expect(getGroupAdvancementStatus(0, team0Wins("finished"))).toBe(
			"clinched",
		);
		// Live wins don't count → team 0 has 0 finalized pts and can still
		// finish bottom, so it is NOT clinched.
		expect(getGroupAdvancementStatus(0, team0Wins("live"))).not.toBe(
			"clinched",
		);
	});
});

describe("knockoutWinner — live games don't decide a winner", () => {
	const base: KnockoutMatch = {
		id: "M104",
		round: "FINAL",
		homeIdx: 0,
		awayIdx: 1,
		homeScore: 2,
		awayScore: 1,
		played: true,
		homeSeed: "Winner M101",
		awaySeed: "Winner M102",
	};

	test("finished → winner by score", () => {
		expect(knockoutWinner({ ...base, status: "finished" })).toBe(0);
	});

	test("live → null (no premature champion/advancer)", () => {
		expect(knockoutWinner({ ...base, status: "live" })).toBeNull();
	});

	test("finished with tied regulation score → ESPN winnerIdx decides (ET/pens)", () => {
		expect(
			knockoutWinner({
				...base,
				status: "finished",
				homeScore: 1,
				awayScore: 1,
				winnerIdx: 1,
			}),
		).toBe(1);
	});

	test("live ET/pen game with winnerIdx set → still null until finalized", () => {
		expect(
			knockoutWinner({
				...base,
				status: "live",
				homeScore: 1,
				awayScore: 1,
				winnerIdx: 1,
			}),
		).toBeNull();
	});
});
