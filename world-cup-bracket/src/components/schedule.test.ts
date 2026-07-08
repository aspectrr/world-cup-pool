import { describe, test, expect } from "bun:test";
import type { GroupMatch, KnockoutMatch } from "../types";
import {
	buildScheduleDays,
	dayKey,
	formatDate,
	roundLabel,
} from "./schedule";

// Fixed "now" so every test is deterministic. Games are spaced ≥2 days apart
// at noon UTC so local-day grouping is stable regardless of the runner's TZ.
const NOW = new Date("2026-07-08T12:00:00Z");
const TODAY_KEY = dayKey(NOW.toISOString());

function group(
	over: Partial<GroupMatch> & Pick<GroupMatch, "id" | "group" | "round">,
): GroupMatch {
	return {
		homeIdx: 0,
		awayIdx: 1,
		homeScore: null,
		awayScore: null,
		played: false,
		...over,
	};
}

function ko(
	over: Partial<KnockoutMatch> & Pick<KnockoutMatch, "id" | "round">,
): KnockoutMatch {
	return {
		homeIdx: null,
		awayIdx: null,
		homeScore: null,
		awayScore: null,
		played: false,
		homeSeed: "1A",
		awaySeed: "2B",
		...over,
	};
}

describe("dayKey", () => {
	test("formats a full ISO string as YYYY-MM-DD", () => {
		expect(dayKey("2026-07-08T12:00:00Z")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	test("returns empty string for no date", () => {
		expect(dayKey("")).toBe("");
	});

	test("is stable for instants within the same local day", () => {
		// Two instants 6h apart stay on the same local day in any TZ.
		expect(dayKey("2026-07-08T06:00:00Z")).toBe(dayKey("2026-07-08T18:00:00Z"));
	});
});

describe("roundLabel", () => {
	test("expands knockout round codes", () => {
		expect(roundLabel("R32")).toBe("Round of 32");
		expect(roundLabel("R16")).toBe("Round of 16");
		expect(roundLabel("QF")).toBe("Quarter-final");
		expect(roundLabel("SF")).toBe("Semi-final");
		expect(roundLabel("FINAL")).toBe("Final");
	});

	test("passes group labels through unchanged", () => {
		expect(roundLabel("Group A")).toBe("Group A");
	});
});

describe("buildScheduleDays", () => {
	test("inserts a synthetic empty 'today' chip when today has no games", () => {
		const gMatches = [
			group({
				id: "G0",
				group: "A",
				round: 1,
				date: "2026-07-05T12:00:00Z",
				played: true,
				status: "finished",
				homeScore: 2,
				awayScore: 0,
			}),
			group({
				id: "G1",
				group: "A",
				round: 1,
				date: "2026-07-10T12:00:00Z",
				status: "scheduled",
			}),
		];

		const { days, nextGame } = buildScheduleDays(gMatches, [], TODAY_KEY, NOW);

		// Today appears as its own (empty) entry…
		const today = days.find((d) => d.key === TODAY_KEY);
		expect(today).toBeDefined();
		expect(today!.games).toHaveLength(0);

		// …and sits chronologically between the two real match days.
		const keys = days.map((d) => d.key);
		const iToday = keys.indexOf(TODAY_KEY);
		expect(keys[iToday - 1]).toBe(dayKey("2026-07-05T12:00:00Z"));
		expect(keys[iToday + 1]).toBe(dayKey("2026-07-10T12:00:00Z"));

		// nextGame points at the upcoming fixture.
		expect(nextGame).not.toBeNull();
		expect(nextGame!.date).toBe("2026-07-10T12:00:00Z");
	});

	test("does not duplicate today when today already has a game", () => {
		const gMatches = [
			group({
				id: "G0",
				group: "A",
				round: 1,
				// Later today — same local day as NOW in any TZ (6h apart).
				date: "2026-07-08T18:00:00Z",
				status: "scheduled",
			}),
		];

		const { days, nextGame } = buildScheduleDays(gMatches, [], TODAY_KEY, NOW);

		const todayEntries = days.filter((d) => d.key === TODAY_KEY);
		expect(todayEntries).toHaveLength(1);
		expect(todayEntries[0].games).toHaveLength(1);
		expect(todayEntries[0].games[0].id).toBe("G0");

		// A scheduled game later today is itself the next fixture.
		expect(nextGame!.date).toBe("2026-07-08T18:00:00Z");
	});

	test("keeps today grouped when its only game is already finished", () => {
		const gMatches = [
			group({
				id: "G0",
				group: "A",
				round: 1,
				// Earlier today, finished.
				date: "2026-07-08T06:00:00Z",
				played: true,
				status: "finished",
				homeScore: 1,
				awayScore: 1,
			}),
			group({
				id: "G1",
				group: "A",
				round: 1,
				date: "2026-07-11T12:00:00Z",
				status: "scheduled",
			}),
		];

		const { days, nextGame } = buildScheduleDays(gMatches, [], TODAY_KEY, NOW);

		// No synthetic empty chip — today already has a (finished) game.
		const todayEntries = days.filter((d) => d.key === TODAY_KEY);
		expect(todayEntries).toHaveLength(1);
		expect(todayEntries[0].games).toHaveLength(1);

		// nextGame skips the finished game and lands on the future one.
		expect(nextGame!.date).toBe("2026-07-11T12:00:00Z");
	});

	test("nextGame is the earliest future non-finished fixture", () => {
		const gMatches = [
			group({
				id: "G0",
				group: "A",
				round: 1,
				date: "2026-07-05T12:00:00Z",
				played: true,
				status: "finished",
				homeScore: 3,
				awayScore: 1,
			}),
			group({
				id: "G1",
				group: "A",
				round: 1,
				date: "2026-07-12T12:00:00Z",
				status: "scheduled",
			}),
			group({
				id: "G2",
				group: "A",
				round: 1,
				date: "2026-07-10T12:00:00Z",
				status: "scheduled",
			}),
		];

		const { nextGame } = buildScheduleDays(gMatches, [], TODAY_KEY, NOW);

		// Picks 07-10 even though 07-12 was declared first — earliest wins.
		expect(nextGame!.date).toBe("2026-07-10T12:00:00Z");
		expect(nextGame!.round).toBe("Group A");
	});

	test("nextGame is null when no future fixtures remain", () => {
		const gMatches = [
			group({
				id: "G0",
				group: "A",
				round: 1,
				date: "2026-07-05T12:00:00Z",
				played: true,
				status: "finished",
				homeScore: 2,
				awayScore: 0,
			}),
		];

		const { days, nextGame } = buildScheduleDays(gMatches, [], TODAY_KEY, NOW);

		expect(nextGame).toBeNull();
		// Today is still rendered as an empty chip (tournament is over, but
		// the bar still shows today rather than skipping to the last match day).
		expect(days.find((d) => d.key === TODAY_KEY)?.games).toHaveLength(0);
	});

	test("skips knockout matches with TBD teams (null homeIdx/awayIdx)", () => {
		// The only future fixture is an unseeded knockout match — it should
		// be excluded from `all`, so nextGame is null.
		const kMatches = [
			ko({
				id: "M89",
				round: "R16",
				homeIdx: null,
				awayIdx: null,
				date: "2026-07-10T12:00:00Z",
				status: "scheduled",
			}),
		];

		const { nextGame } = buildScheduleDays([], kMatches, TODAY_KEY, NOW);
		expect(nextGame).toBeNull();
	});

	test("includes a resolved knockout match as nextGame with its round", () => {
		const kMatches = [
			ko({
				id: "M73",
				round: "R32",
				homeIdx: 10,
				awayIdx: 20,
				date: "2026-07-10T12:00:00Z",
				status: "scheduled",
			}),
		];

		const { nextGame } = buildScheduleDays([], kMatches, TODAY_KEY, NOW);
		expect(nextGame).not.toBeNull();
		expect(nextGame!.homeIdx).toBe(10);
		expect(nextGame!.awayIdx).toBe(20);
		expect(nextGame!.round).toBe("R32");
		expect(roundLabel(nextGame!.round)).toBe("Round of 32");
	});

	test("merges group and knockout matches sharing a day into one entry", () => {
		const gMatches = [
			group({
				id: "G0",
				group: "A",
				round: 1,
				date: "2026-07-10T12:00:00Z",
				status: "scheduled",
			}),
		];
		const kMatches = [
			ko({
				id: "M73",
				round: "R32",
				homeIdx: 4,
				awayIdx: 5,
				date: "2026-07-10T18:00:00Z",
				status: "scheduled",
			}),
		];

		const { days } = buildScheduleDays(gMatches, kMatches, TODAY_KEY, NOW);
		const shared = days.find((d) => d.key === dayKey("2026-07-10T12:00:00Z"));
		expect(shared?.games.map((g) => g.id).sort()).toEqual(["G0", "M73"]);
	});

	test("sorts days chronologically regardless of input order", () => {
		const gMatches = [
			group({ id: "G2", group: "A", round: 1, date: "2026-07-12T12:00:00Z" }),
			group({ id: "G0", group: "A", round: 1, date: "2026-07-05T12:00:00Z" }),
			group({ id: "G1", group: "A", round: 1, date: "2026-07-10T12:00:00Z" }),
		];

		const { days } = buildScheduleDays(gMatches, [], TODAY_KEY, NOW);
		expect(days.map((d) => d.key)).toEqual([
			dayKey("2026-07-05T12:00:00Z"),
			TODAY_KEY,
			dayKey("2026-07-10T12:00:00Z"),
			dayKey("2026-07-12T12:00:00Z"),
		]);
	});

	test("synthetic today chip label reflects today's date", () => {
		const { days } = buildScheduleDays(
			[
				group({
					id: "G0",
					group: "A",
					round: 1,
					date: "2026-07-05T12:00:00Z",
					played: true,
					status: "finished",
					homeScore: 1,
					awayScore: 0,
				}),
			],
			[],
			TODAY_KEY,
			NOW,
		);

		const today = days.find((d) => d.key === TODAY_KEY)!;
		expect(today.label).toBe(formatDate(NOW.toISOString()));
		expect(today.games).toHaveLength(0);
	});
});
