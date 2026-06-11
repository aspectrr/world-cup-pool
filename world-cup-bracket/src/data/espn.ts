/** Map ESPN team abbreviations → our TEAMS array index */
export const ESPN_ABBR_TO_IDX: Record<string, number> = {
	MEX: 0, // Mexico
	RSA: 1, // South Africa
	KOR: 2, // South Korea
	CZE: 3, // Czech Republic
	CAN: 4, // Canada
	BIH: 5, // Bosnia and Herzegovina
	QAT: 6, // Qatar
	SUI: 7, // Switzerland
	BRA: 8, // Brazil
	MAR: 9, // Morocco
	HAI: 10, // Haiti
	SCO: 11, // Scotland
	USA: 12, // United States
	PAR: 13, // Paraguay
	AUS: 14, // Australia
	TUR: 15, // Turkey
	GER: 16, // Germany
	CUR: 17, // Curaçao
	CIV: 18, // Ivory Coast
	ECU: 19, // Ecuador
	NED: 20, // Netherlands
	JPN: 21, // Japan
	SWE: 22, // Sweden
	TUN: 23, // Tunisia
	BEL: 24, // Belgium
	EGY: 25, // Egypt
	IRN: 26, // Iran
	NZL: 27, // New Zealand
	ESP: 28, // Spain
	CPV: 29, // Cape Verde
	KSA: 30, // Saudi Arabia
	URU: 31, // Uruguay
	FRA: 32, // France
	SEN: 33, // Senegal
	IRQ: 34, // Iraq
	NOR: 35, // Norway
	ARG: 36, // Argentina
	ALG: 37, // Algeria
	AUT: 38, // Austria
	JOR: 39, // Jordan
	POR: 40, // Portugal
	COD: 41, // DR Congo
	UZB: 42, // Uzbekistan
	COL: 43, // Colombia
	ENG: 44, // England
	CRO: 45, // Croatia
	GHA: 46, // Ghana
	PAN: 47, // Panama
};

// Some teams have alternate ESPN abbreviations
export const ESPN_ALT_ABBR: Record<string, string> = {
	TCH: "CZE", // Czech Republic alternate
	IVC: "CIV", // Ivory Coast alternate
	CGO: "COD", // DR Congo alternate
	SAU: "KSA", // Saudi Arabia alternate
};

function resolveIdx(abbr: string): number | null {
	const normalized = ESPN_ALT_ABBR[abbr] ?? abbr;
	return ESPN_ABBR_TO_IDX[normalized] ?? null;
}

export interface ESPNMatch {
	espnId: string;
	homeIdx: number;
	awayIdx: number;
	homeScore: number;
	awayScore: number;
	status: "scheduled" | "live" | "finished";
	clock: string; // e.g. "45'+2'" or "FT"
	date: string;
}

export function parseESMNScoreboard(data: {
	events?: Array<{
		id: string;
		date: string;
		status: { type: { state: string; name: string }; displayClock: string };
		competitions: Array<{
			competitors: Array<{
				homeAway: string;
				score: string;
				team: { abbreviation: string };
			}>;
		}>;
	}>;
}): ESPNMatch[] {
	const events = data.events ?? [];
	const matches: ESPNMatch[] = [];

	for (const event of events) {
		const comp = event.competitions?.[0];
		if (!comp) continue;

		const homeComp = comp.competitors.find((c) => c.homeAway === "home");
		const awayComp = comp.competitors.find((c) => c.homeAway === "away");
		if (!homeComp || !awayComp) continue;

		const homeIdx = resolveIdx(homeComp.team.abbreviation);
		const awayIdx = resolveIdx(awayComp.team.abbreviation);
		if (homeIdx === null || awayIdx === null) continue;

		const state = event.status?.type?.state ?? "pre";
		const status: ESPNMatch["status"] =
			state === "in" ? "live" : state === "post" ? "finished" : "scheduled";

		matches.push({
			espnId: event.id,
			homeIdx,
			awayIdx,
			homeScore: parseInt(homeComp.score, 10) || 0,
			awayScore: parseInt(awayComp.score, 10) || 0,
			status,
			clock: event.status?.displayClock ?? "",
			date: event.date,
		});
	}

	return matches;
}
