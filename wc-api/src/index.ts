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
}

function parseESMNScoreboard(data: {
	events?: Array<{
		id: string;
		date: string;
		status: { type: { state: string }; displayClock: string };
		competitions: Array<{
			competitors: Array<{
				homeAway: string;
				score: string;
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

// ── SQLite ───────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.resolve(DATA_DIR, "matches.db");
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

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
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	)
`);

const upsertStmt = db.prepare(`
	INSERT INTO results (match_id, espn_id, home_idx, away_idx, home_score, away_score, status, clock, date, updated_at)
	VALUES (@matchId, @espnId, @homeIdx, @awayIdx, @homeScore, @awayScore, @status, @clock, @date, datetime('now'))
	ON CONFLICT(match_id) DO UPDATE SET
		espn_id = @espnId,
		home_score = @homeScore,
		away_score = @awayScore,
		status = @status,
		clock = @clock,
		date = @date,
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
		});
	}

	return {
		matches: Array.from(byKey.values()),
		lastPoll: lastPollTime?.toISOString() ?? null,
		error: pollError,
	};
}

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
	const { matches } = req.body as Array<{ home_idx: number; away_idx: number; home_score: number; away_score: number; date?: string }>;
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
			});
		}
	});
	transaction();
	console.log(`[seed] inserted ${matches.length} match(es)`);
	res.json(buildResults());
});

// Health check
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
