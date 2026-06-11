import type { Team } from "../types";

export const TEAMS: Team[] = [
	// Group A
	{ name: "Mexico", code: "mx", group: "A", groupPos: 1, fifaRank: 15 },
	{ name: "South Africa", code: "za", group: "A", groupPos: 2, fifaRank: 61 },
	{ name: "South Korea", code: "kr", group: "A", groupPos: 3, fifaRank: 25 },
	{ name: "Czech Republic", code: "cz", group: "A", groupPos: 4, fifaRank: 47 },

	// Group B
	{ name: "Canada", code: "ca", group: "B", groupPos: 1, fifaRank: 27 },
	{
		name: "Bosnia and Herzegovina",
		code: "ba",
		group: "B",
		groupPos: 2,
		fifaRank: 52,
	},
	{ name: "Qatar", code: "qa", group: "B", groupPos: 3, fifaRank: 51 },
	{ name: "Switzerland", code: "ch", group: "B", groupPos: 4, fifaRank: 19 },

	// Group C
	{ name: "Brazil", code: "br", group: "C", groupPos: 1, fifaRank: 5 },
	{ name: "Morocco", code: "ma", group: "C", groupPos: 2, fifaRank: 8 },
	{ name: "Haiti", code: "ht", group: "C", groupPos: 3, fifaRank: 84 },
	{ name: "Scotland", code: "gb-sct", group: "C", groupPos: 4, fifaRank: 36 },

	// Group D
	{ name: "United States", code: "us", group: "D", groupPos: 1, fifaRank: 16 },
	{ name: "Paraguay", code: "py", group: "D", groupPos: 2, fifaRank: 39 },
	{ name: "Australia", code: "au", group: "D", groupPos: 3, fifaRank: 26 },
	{ name: "Turkey", code: "tr", group: "D", groupPos: 4, fifaRank: 22 },

	// Group E
	{ name: "Germany", code: "de", group: "E", groupPos: 1, fifaRank: 9 },
	{ name: "Curaçao", code: "cw", group: "E", groupPos: 2, fifaRank: 82 },
	{ name: "Ivory Coast", code: "ci", group: "E", groupPos: 3, fifaRank: 42 },
	{ name: "Ecuador", code: "ec", group: "E", groupPos: 4, fifaRank: 23 },

	// Group F
	{ name: "Netherlands", code: "nl", group: "F", groupPos: 1, fifaRank: 7 },
	{ name: "Japan", code: "jp", group: "F", groupPos: 2, fifaRank: 18 },
	{ name: "Sweden", code: "se", group: "F", groupPos: 3, fifaRank: 45 },
	{ name: "Tunisia", code: "tn", group: "F", groupPos: 4, fifaRank: 40 },

	// Group G
	{ name: "Belgium", code: "be", group: "G", groupPos: 1, fifaRank: 8 },
	{ name: "Egypt", code: "eg", group: "G", groupPos: 2, fifaRank: 34 },
	{ name: "Iran", code: "ir", group: "G", groupPos: 3, fifaRank: 21 },
	{ name: "New Zealand", code: "nz", group: "G", groupPos: 4, fifaRank: 86 },

	// Group H
	{ name: "Spain", code: "es", group: "H", groupPos: 1, fifaRank: 2 },
	{ name: "Cape Verde", code: "cv", group: "H", groupPos: 2, fifaRank: 68 },
	{ name: "Saudi Arabia", code: "sa", group: "H", groupPos: 3, fifaRank: 60 },
	{ name: "Uruguay", code: "uy", group: "H", groupPos: 4, fifaRank: 17 },

	// Group I
	{ name: "France", code: "fr", group: "I", groupPos: 1, fifaRank: 1 },
	{ name: "Senegal", code: "sn", group: "I", groupPos: 2, fifaRank: 14 },
	{ name: "Iraq", code: "iq", group: "I", groupPos: 3, fifaRank: 55 },
	{ name: "Norway", code: "no", group: "I", groupPos: 4, fifaRank: 29 },

	// Group J
	{ name: "Argentina", code: "ar", group: "J", groupPos: 1, fifaRank: 2 },
	{ name: "Algeria", code: "dz", group: "J", groupPos: 2, fifaRank: 35 },
	{ name: "Austria", code: "at", group: "J", groupPos: 3, fifaRank: 24 },
	{ name: "Jordan", code: "jo", group: "J", groupPos: 4, fifaRank: 66 },

	// Group K
	{ name: "Portugal", code: "pt", group: "K", groupPos: 1, fifaRank: 6 },
	{ name: "DR Congo", code: "cd", group: "K", groupPos: 2, fifaRank: 56 },
	{ name: "Uzbekistan", code: "uz", group: "K", groupPos: 3, fifaRank: 50 },
	{ name: "Colombia", code: "co", group: "K", groupPos: 4, fifaRank: 13 },

	// Group L
	{ name: "England", code: "gb-eng", group: "L", groupPos: 1, fifaRank: 4 },
	{ name: "Croatia", code: "hr", group: "L", groupPos: 2, fifaRank: 11 },
	{ name: "Ghana", code: "gh", group: "L", groupPos: 3, fifaRank: 72 },
	{ name: "Panama", code: "pa", group: "L", groupPos: 4, fifaRank: 30 },
];

export const GROUPS = [
	"A",
	"B",
	"C",
	"D",
	"E",
	"F",
	"G",
	"H",
	"I",
	"J",
	"K",
	"L",
] as const;

export function flagUrl(code: string): string {
	return `https://flagcdn.com/w80/${code}.png`;
}

export function teamFlag(idx: number): string {
	return flagUrl(TEAMS[idx].code);
}

/** Shorten long team names to fit on one line */
export function shortName(name: string, max = 14): string {
	return name.length > max ? name.slice(0, max - 1) + "…" : name;
}
