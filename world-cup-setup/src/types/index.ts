export type Screen = "setup" | "draw" | "complete";

export interface DrawState {
	players: string[];
	playerTeams: number[][]; // playerIdx -> team indices
	playerUsedGroups: Set<string>[]; // playerIdx -> groups already taken
	availableTeams: Set<number>; // team indices not yet picked
	pickOrder: number[]; // playerIdx per pick
	currentPick: number; // 0-47
}
