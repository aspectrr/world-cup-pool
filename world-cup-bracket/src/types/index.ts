export interface Team {
	name: string;
	code: string;
	group: string;
	groupPos: number;
	fifaRank: number;
}

export interface Player {
	name: string;
	teamIndices: number[];
}

export type MatchStatus = "scheduled" | "live" | "finished";

export interface GroupMatch {
	id: string;
	group: string;
	round: 1 | 2 | 3; // matchday
	homeIdx: number; // team index
	awayIdx: number;
	homeScore: number | null;
	awayScore: number | null;
	played: boolean;
	status?: MatchStatus;
	clock?: string; // e.g. "45'+2'"
	date?: string; // ISO datetime from ESPN, e.g. "2026-06-11T19:00Z"
}

export interface KnockoutMatch {
	id: string;
	round: "R32" | "R16" | "QF" | "SF" | "FINAL";
	homeIdx: number | null; // team index, null if TBD
	awayIdx: number | null;
	homeScore: number | null;
	awayScore: number | null;
	played: boolean;
	date?: string; // ISO datetime from ESPN
	homeSeed: string; // e.g. "1A" = winner of group A, "2B" = runner-up, "3C" = 3rd place group C
	awaySeed: string;
}

export type Match = GroupMatch | KnockoutMatch;

export type Tab = "standings" | "groups" | "bracket" | "my-teams";

export interface GroupStanding {
	teamIdx: number;
	played: number;
	won: number;
	drawn: number;
	lost: number;
	gf: number; // goals for
	ga: number; // goals against
	points: number;
}
