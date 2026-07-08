import type { Player } from "../types";

// Draw result: playerTeams[playerIdx] = [teamIndices...]
const DRAW_DATA = {
	players: [
		"Frank",
		"Ailee",
		"Collin",
		"Eli",
		"Mia",
		"Natasha",
		"Kevin",
		"Ella",
	],
	playerTeams: [
		[2, 29, 17, 9, 44, 24], // Frank
		[7, 41, 14, 37, 25, 8], // Ailee
		[47, 10, 20, 6, 18, 32], // Collin
		[3, 16, 42, 33, 28, 13], // Eli
		[31, 0, 5, 21, 38, 45], // Mia
		[46, 26, 12, 22, 43, 39], // Natasha
		[4, 23, 34, 36, 40, 11], // Kevin
		[27, 1, 30, 19, 15, 35], // Ella
	],
};

export const PLAYERS: Player[] = DRAW_DATA.players.map((name, i) => ({
	name,
	teamIndices: DRAW_DATA.playerTeams[i],
}));

/** Pool player who drafted `teamIdx`, or null if the team is unowned. */
export function teamOwner(teamIdx: number): string | null {
	for (const p of PLAYERS) {
		if (p.teamIndices.includes(teamIdx)) return p.name;
	}
	return null;
}

export const PRIZES = {
	winner: 20,
	runnerUp: 10,
	firstOut: 5,
} as const;
