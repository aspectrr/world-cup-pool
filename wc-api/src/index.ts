/**
 * Standalone API server for Fly.io
 * - Polls ESPN scoreboard every 60s
 * - Persists finished match results to SQLite on persistent volume
 * - Exposes /api/results with merged (DB + live ESPN) data
 */
import express from "express";
import cors from "cors";
import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── ESPN parsing ─────────────────────────────────────────────────────

const ESPN_ABBR_TO_IDX: Record<string, number> = {
	MEX: 0, RSA: 1, KOR: 2, CZE: 3, CAN: 4, BIH: 5, QAT: 6, SUI: 7,
	BRA: 8, MAR: 9, HAI: 10, SCO: 11, USA: 12, PAR: 13, AUS: 14, TUR: 15,
	GER: 16, CUR: 17, CIV: 18, ECU: 19, NED: 20, JPN: 21, SWE: 22, TUN: 23,
	BEL: 24, EGY: 25, IRN: 26, NZL: 27, ESP: 28, CPV: 29, KSA: 30, URU: 31,
	FRA: 32, SEN: 33, IRQ: 34, NOR: 35, ARG: 36, ALG: 37, AUT: 38, JOR: 39,
	POR: 40, COD: 41, UZB: 42, COL: 43, ENG: 44, CRO: 45, GHA: 46, PAN: 47,
};

const ESPN_ALT_ABBR: Record<string, string> = {
	TCH: "CZE", IVC: "CIV", CGO: "COD", SAU: "KSA", CUW: "CUR",
};

function resolveIdx(abbr: string): number | null {
	const normalized = ESPN_ALT_ABBR[abbr] ?? abbr;
	return ESPN_ABBR_TO_IDX[normalized] ?? null;
}

interface RawESPNMatch {
	espnId: string;
	homeIdx: number;
	awayIdx: number;
	homeScore: number;
	awayScore: number;
	status: "scheduled" | "live" | "finished";
	clock: string;
	date: string;
	// Winner team idx when ESPN marks a competitor as the winner. Only set
	// for knockout games decided by extra time or penalties (where the
	// regulation score is tied). Null otherwise.
	winnerIdx: number | null;
	// Human-readable status detail from ESPN, e.g. "FT", "FT aet", "Pen".
	// Lets the UI show an AET/Pen tag next to the score.
	detail: string;
}

function parseESMNScoreboard(data: {
	events?: Array<{
		id: string;
		date: string;
		status: {
			type: { state: string; shortDetail?: string; detail?: string };
			displayClock: string;
		};
		competitions: Array<{
			competitors: Array<{
				homeAway: string;
				score: string;
				winner?: boolean;
				team: { abbreviation: string };
			}>;
		}>;
	}>;
}): RawESPNMatch[] {
	const events = data.events ?? [];
	const matches: RawESPNMatch[] = [];

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
		const status: RawESPNMatch["status"] =
			state === "in" ? "live" : state === "post" ? "finished" : "scheduled";

		const homeScore = parseInt(homeComp.score, 10) || 0;
		const awayScore = parseInt(awayComp.score, 10) || 0;
		// ESPN sets `winner: true` on the advancing competitor for knockout
		// games decided by ET or pens. Regulation score may stay tied.
		const winnerIdx =
			homeComp.winner === true
				? homeIdx
				: awayComp.winner === true
					? awayIdx
					: null;
		const detail =
			event.status?.type?.shortDetail ??
			event.status?.type?.detail ??
			"";

		matches.push({
			espnId: event.id,
			homeIdx,
			awayIdx,
			homeScore,
			awayScore,
			status,
			clock: event.status?.displayClock ?? "",
			date: event.date,
			winnerIdx,
			detail,
		});
	}
	return matches;
}

// ── SQLite ───────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.resolve(DATA_DIR, "matches.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

// winner_idx / detail added for knockout games decided by ET or pens.
// Added via ALTER TABLE so existing DBs on the persistent volume upgrade
// in place without needing to recreate the table.
try {
	db.exec("ALTER TABLE results ADD COLUMN winner_idx INTEGER");
} catch (_e) {
	/* column already exists */
}
try {
	db.exec("ALTER TABLE results ADD COLUMN detail TEXT NOT NULL DEFAULT ''");
} catch (_e) {
	/* column already exists */
}

db.exec(`
	CREATE TABLE IF NOT EXISTS results (
		match_id TEXT PRIMARY KEY,
		espn_id TEXT,
		home_idx INTEGER NOT NULL,
		away_idx INTEGER NOT NULL,
		home_score INTEGER NOT NULL,
		away_score INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'finished',
		clock TEXT NOT NULL DEFAULT '',
		date TEXT NOT NULL DEFAULT '',
		winner_idx INTEGER,
		detail TEXT NOT NULL DEFAULT '',
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

const upsertStmt = db.prepare(`
	INSERT INTO results (match_id, espn_id, home_idx, away_idx, home_score, away_score, status, clock, date, winner_idx, detail, updated_at)
	VALUES (@matchId, @espnId, @homeIdx, @awayIdx, @homeScore, @awayScore, @status, @clock, @date, @winnerIdx, @detail, datetime('now'))
	ON CONFLICT(match_id) DO UPDATE SET
		espn_id = @espnId,
		home_score = @homeScore,
		away_score = @awayScore,
		status = @status,
		clock = @clock,
		date = @date,
		winner_idx = @winnerIdx,
		detail = @detail,
		updated_at = datetime('now')
`);

const getAllStmt = db.prepare("SELECT * FROM results");

// ── ESPN Polling ─────────────────────────────────────────────────────

const SCOREBOARD_URL =
	"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const POLL_INTERVAL = 60_000;

interface StoredMatch {
	match_id: string;
	espn_id: string | null;
	home_idx: number;
	away_idx: number;
	home_score: number;
	away_score: number;
	status: string;
	clock: string;
	date: string;
	winner_idx: number | null;
	detail: string;
}

let liveCache: RawESPNMatch[] = [];
let lastPollTime: Date | null = null;
let pollError: string | null = null;

async function pollESPN(): Promise<void> {
	try {
		const res = await fetch(SCOREBOARD_URL);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const json = await res.json();
		const matches = parseESMNScoreboard(json);

		// Persist finished matches to SQLite
		const toSave = matches.filter((m) => m.status === "finished");
		const transaction = db.transaction(() => {
			for (const m of toSave) {
				const matchId = `${m.homeIdx}v${m.awayIdx}`;
				upsertStmt.run({
					matchId,
					espnId: m.espnId,
					homeIdx: m.homeIdx,
					awayIdx: m.awayIdx,
					homeScore: m.homeScore,
					awayScore: m.awayScore,
					status: m.status,
					clock: m.clock,
					date: m.date,
					winnerIdx: m.winnerIdx,
					detail: m.detail,
				});
			}
		});
		transaction();

		liveCache = matches;
		lastPollTime = new Date();
		pollError = null;
		console.log(
			`[poll] ${new Date().toISOString()} — ${matches.length} from ESPN, ${toSave.length} finished saved to DB`,
		);
	} catch (e) {
		pollError = e instanceof Error ? e.message : "Unknown error";
		console.error(`[poll] ${new Date().toISOString()} — ${pollError}`);
	}
}

// Initial poll, then every 60s
pollESPN();
setInterval(pollESPN, POLL_INTERVAL);

// ── API response builder ─────────────────────────────────────────────

function buildResults() {
	const dbRows = getAllStmt.all() as StoredMatch[];
	const byKey = new Map<string, StoredMatch>();
	for (const r of dbRows) {
		byKey.set(r.match_id, r);
	}

	// Live ESPN data overrides DB for current matches
	for (const m of liveCache) {
		const key = `${m.homeIdx}v${m.awayIdx}`;
		byKey.set(key, {
			match_id: key,
			espn_id: m.espnId,
			home_idx: m.homeIdx,
			away_idx: m.awayIdx,
			home_score: m.homeScore,
			away_score: m.awayScore,
			status: m.status,
			clock: m.clock,
			date: m.date,
			winner_idx: m.winnerIdx,
			detail: m.detail,
		});
	}

	return {
		matches: Array.from(byKey.values()),
		lastPoll: lastPollTime?.toISOString() ?? null,
		error: pollError,
	};
}

// ── Polymarket odds ─────────────────────────────────────────────────
// Public, keyless Gamma API. Each WC match is one event with three binary
// markets: "Will {Home} win?", "Will it end in a draw?", "Will {Away} win?".
// The Yes price of each ≈ implied probability (they sum to ~1.0 minus vig).

// 48 WC team names — kept in sync with world-cup-bracket/src/data/teams.ts.
// ponytail: duplicated from the frontend rather than shared, to keep the
// API server dependency-free. Update both if the field changes.
const WC_TEAMS: string[] = [
	"Mexico", "South Africa", "South Korea", "Czech Republic",
	"Canada", "Bosnia and Herzegovina", "Qatar", "Switzerland",
	"Brazil", "Morocco", "Haiti", "Scotland",
	"United States", "Paraguay", "Australia", "Turkey",
	"Germany", "Curaçao", "Ivory Coast", "Ecuador",
	"Netherlands", "Japan", "Sweden", "Tunisia",
	"Belgium", "Egypt", "Iran", "New Zealand",
	"Spain", "Cape Verde", "Saudi Arabia", "Uruguay",
	"France", "Senegal", "Iraq", "Norway",
	"Argentina", "Algeria", "Austria", "Jordan",
	"Portugal", "DR Congo", "Uzbekistan", "Colombia",
	"England", "Croatia", "Ghana", "Panama",
];

// Our team names → idx. Aliases cover Polymarket's title variants.
const PM_ALIAS: Record<string, string> = {
	"cote d'ivoire": "ivory coast",
	"cabo verde": "cape verde",
	czechia: "czech republic",
	"bosnia": "bosnia and herzegovina",
	"south korea": "south korea",
};

function normalizeName(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

const PM_NAME_TO_IDX = new Map<string, number>();
for (let i = 0; i < WC_TEAMS.length; i++) {
	PM_NAME_TO_IDX.set(normalizeName(WC_TEAMS[i]), i);
}
for (const [alias, canonical] of Object.entries(PM_ALIAS)) {
	const idx = PM_NAME_TO_IDX.get(canonical);
	if (idx !== undefined) PM_NAME_TO_IDX.set(normalizeName(alias), idx);
}

function pmTeamIdx(name: string): number | null {
	return PM_NAME_TO_IDX.get(normalizeName(name)) ?? null;
}

interface PmMarket {
	question: string;
	outcomes: string; // JSON-encoded, e.g. '["Yes","No"]'
	outcomePrices: string; // JSON-encoded
}

interface PmEvent {
	slug: string;
	title: string;
	markets?: PmMarket[];
}

// pair key canonicalized by team-idx order so the frontend can look up
// regardless of which side is home in our schedule.
function pairKey(a: number, b: number): string {
	return a < b ? `${a}v${b}` : `${b}v${a}`;
}

interface MatchOdds {
	pcts: Record<number, number>; // teamIdx → implied win prob (0..1)
	draw: number; // implied draw prob (0..1)
}

let oddsCache: Record<string, MatchOdds> = {};
let oddsLastPoll: Date | null = null;
let oddsError: string | null = null;

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events";
const ODDS_POLL_INTERVAL = 60_000;

// Skip derivative event variants — we only want the base moneyline event.
const PM_VARIANT = /(more-markets|exact-score|total-corners|player-props|both-teams-to-score)/;

async function pollPolymarket(): Promise<void> {
	try {
		const url =
			`${GAMMA_EVENTS_URL}?limit=300&closed=false` +
			`&order=volume24hr&ascending=false&tag=soccer`;
		const res = await fetch(url);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const events = (await res.json()) as PmEvent[];

		const out: Record<string, MatchOdds> = {};
		for (const ev of events) {
			if (!ev.slug.startsWith("fifwc-")) continue;
			if (PM_VARIANT.test(ev.slug)) continue;

			// Title shape: "Home vs. Away" (or "Home vs Away").
			const parts = ev.title.split(/\s+vs\.?\s+/);
			if (parts.length !== 2) continue;
			const homeIdx = pmTeamIdx(parts[0]);
			const awayIdx = pmTeamIdx(parts[1]);
			if (homeIdx === null || awayIdx === null) continue;

			const pcts: Record<number, number> = {};
			let draw: number | null = null;

			const parseJson = <T,>(s: string | undefined): T[] => {
				if (!s) return [];
				try {
					const v = JSON.parse(s);
					return Array.isArray(v) ? (v as T[]) : [];
				} catch {
					return []
				}
			};

			for (const m of ev.markets ?? []) {
				const outcomes = parseJson<string>(m.outcomes);
				const prices = parseJson<string>(m.outcomePrices);
				const yesIdx = outcomes.indexOf("Yes");
				const yes = yesIdx >= 0 ? Number(prices[yesIdx]) : NaN;
				if (!Number.isFinite(yes)) continue;

				const winMatch = m.question.match(/^Will (.+?) win on /);
				if (winMatch) {
					const idx = pmTeamIdx(winMatch[1]);
					if (idx !== null) pcts[idx] = yes;
					continue;
				}
				if (/draw/i.test(m.question)) draw = yes;
			}

			// Only emit if we resolved both win prices.
			if (pcts[homeIdx] === undefined || pcts[awayIdx] === undefined) continue;
			out[pairKey(homeIdx, awayIdx)] = {
				pcts,
				draw: draw ?? 0,
			};
		}

		oddsCache = out;
		oddsLastPoll = new Date();
		oddsError = null;
		console.log(
			`[odds] ${new Date().toISOString()} — priced ${Object.keys(out).length} matches`,
		);
	} catch (e) {
		oddsError = e instanceof Error ? e.message : "Unknown error";
		console.error(`[odds] ${new Date().toISOString()} — ${oddsError}`);
	}
}

pollPolymarket();
setInterval(pollPolymarket, ODDS_POLL_INTERVAL);

// ── Express ──────────────────────────────────────────────────────────

const app = express();
const PORT = parseInt(process.env.PORT ?? "3000", 10);

app.use(cors());
app.use(express.json());

app.get("/api/results", (_req, res) => {
	res.json(buildResults());
});

app.post("/api/poll", async (_req, res) => {
	await pollESPN();
	res.json(buildResults());
});

// Manual score entry — seed historical results
app.post("/api/seed", (req, res) => {
	const { matches } = req.body as {
		matches: Array<{
			home_idx: number;
			away_idx: number;
			home_score: number;
			away_score: number;
			date?: string;
			winner_idx?: number | null;
			detail?: string;
		}>;
	};
	if (!Array.isArray(matches)) {
		res.status(400).json({ error: "Expected { matches: [...] }" });
		return;
	}
	const transaction = db.transaction(() => {
		for (const m of matches) {
			const matchId = `${m.home_idx}v${m.away_idx}`;
			upsertStmt.run({
				matchId,
				espnId: null,
				homeIdx: m.home_idx,
				awayIdx: m.away_idx,
				homeScore: m.home_score,
				awayScore: m.away_score,
				status: "finished",
				clock: "FT",
				date: m.date ?? "",
				winnerIdx: m.winner_idx ?? null,
				detail: m.detail ?? "",
			});
		}
	});
	transaction();
	console.log(`[seed] inserted ${matches.length} match(es)`);
	res.json(buildResults());
});

// Health check
app.get("/api/odds", (_req, res) => {
	res.json({
		odds: oddsCache,
		lastPoll: oddsLastPoll?.toISOString() ?? null,
		error: oddsError,
	});
});

app.get("/api/health", (_req, res) => {
	const dbRows = getAllStmt.all() as StoredMatch[];
	res.json({
		status: "ok",
		db: DB_PATH,
		storedMatches: dbRows.length,
		liveMatches: liveCache.length,
		lastPoll: lastPollTime?.toISOString() ?? null,
		error: pollError,
	});
});

app.listen(PORT, () => {
	console.log(`[wc-api] listening on :${PORT}`);
	console.log(`[wc-api] db=${DB_PATH}`);
});
