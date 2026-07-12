/**
 * Standalone API server for Fly.io (Bun + Elysia + Drizzle on bun:sqlite)
 * - Polls ESPN scoreboard every 20s
 * - Persists finished match results to SQLite on persistent volume
 * - Exposes /api/results with merged (DB + live ESPN) data
 * - Streams live updates + Polymarket odds over /ws
 */
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Minimal structural type for what we use off the Elysia ws context —
// avoids coupling to Elysia's private WSEvent shape.
interface WsClient {
	readyState: number;
	send: (data: string) => void;
}
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");

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

// ── Drizzle schema + SQLite ──────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.resolve(DATA_DIR, "matches.db");

// Raw bun:sqlite handle for pragmas + in-place migrations.
const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL;");

// winner_idx / detail added for knockout games decided by ET or pens.
// ALTER TABLE so existing DBs on the persistent volume upgrade in place.
// ponytail: migrations as raw SQL matches the prior scheme; promote to
// drizzle-kit migrate when the schema starts churning.
sqlite.exec(`
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
try {
	sqlite.exec("ALTER TABLE results ADD COLUMN winner_idx INTEGER");
} catch { /* column exists */ }
try {
	sqlite.exec("ALTER TABLE results ADD COLUMN detail TEXT NOT NULL DEFAULT ''");
} catch { /* column exists */ }

const results = sqliteTable("results", {
	matchId: text("match_id").primaryKey(),
	espnId: text("espn_id"),
	homeIdx: integer("home_idx").notNull(),
	awayIdx: integer("away_idx").notNull(),
	homeScore: integer("home_score").notNull(),
	awayScore: integer("away_score").notNull(),
	status: text("status").notNull().default("finished"),
	clock: text("clock").notNull().default(""),
	date: text("date").notNull().default(""),
	winnerIdx: integer("winner_idx"),
	detail: text("detail").notNull().default(""),
	updatedAt: text("updated_at").notNull().default(sql`(datetime('now'))`),
});

const db = drizzle(sqlite);

// Snake-case row shape kept identical to the old better-sqlite3 output —
// the frontend's ServerMatch type depends on it.
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

function rowToStored(r: typeof results.$inferSelect): StoredMatch {
	return {
		match_id: r.matchId,
		espn_id: r.espnId,
		home_idx: r.homeIdx,
		away_idx: r.awayIdx,
		home_score: r.homeScore,
		away_score: r.awayScore,
		status: r.status,
		clock: r.clock,
		date: r.date,
		winner_idx: r.winnerIdx,
		detail: r.detail,
	};
}

function upsertMany(rows: Array<typeof results.$inferInsert>): void {
	if (!rows.length) return;
	// One multi-row INSERT ... ON CONFLICT statement — atomic + fast.
	db.insert(results)
		.values(rows)
		.onConflictDoUpdate({
			target: results.matchId,
			set: {
				espnId: sql`excluded.espn_id`,
				homeScore: sql`excluded.home_score`,
				awayScore: sql`excluded.away_score`,
				status: sql`excluded.status`,
				clock: sql`excluded.clock`,
				date: sql`excluded.date`,
				winnerIdx: sql`excluded.winner_idx`,
				detail: sql`excluded.detail`,
				updatedAt: sql`(datetime('now'))`,
			},
		})
		.run();
}

// ── ESPN Polling ─────────────────────────────────────────────────────

const SCOREBOARD_URL =
	"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
// 20s — ESPN's REST cache floor. Faster wastes requests for stale data.
// The client WS broadcast (below) is what actually kills perceived latency.
const POLL_INTERVAL = 20_000;

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
		const toSave = matches
			.filter((m) => m.status === "finished")
			.map((m) => ({
				matchId: `${m.homeIdx}v${m.awayIdx}`,
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
			}));
		upsertMany(toSave);

		liveCache = matches;
		lastPollTime = new Date();
		pollError = null;
		console.log(
			`[poll] ${new Date().toISOString()} — ${matches.length} from ESPN, ${toSave.length} finished saved to DB`,
		);
		broadcastMatches();
	} catch (e) {
		pollError = e instanceof Error ? e.message : "Unknown error";
		console.error(`[poll] ${new Date().toISOString()} — ${pollError}`);
	}
}

pollESPN();
setInterval(pollESPN, POLL_INTERVAL);

// ── API response builder ─────────────────────────────────────────────

function buildResults() {
	const dbRows = db.select().from(results).all().map(rowToStored);
	const byKey = new Map<string, StoredMatch>();
	for (const r of dbRows) byKey.set(r.match_id, r);

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

// ── Polymarket odds (via CLOB market WebSocket) ────────────────────
// We subscribe to wss://ws-subscriptions-clob.polymarket.com/ws/market for
// best_bid_ask events on each WC match's Team-to-Advance tokens. Mid-price = implied
// probability. Token IDs are bootstrapped from Gamma REST every few minutes
// (and on startup) so newly-created fixtures appear without a redeploy.

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
	sportsMarketType?: string;
	groupItemTitle?: string; // team name for World Cup Winner markets
	outcomes: string; // JSON-encoded, e.g. '["Germany","Paraguay"]' or '["Yes","No"]'
	outcomePrices: string; // JSON-encoded
	clobTokenIds: string; // JSON-encoded: [homeTokenId, awayTokenId]
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
// teamIdx → implied P(team wins 2026 WC), from the World Cup Winner market.
let winnerProbs: Record<number, number> = {};
let oddsLastPoll: Date | null = null;
let oddsError: string | null = null;

const GAMMA_EVENTS_URL = "https://gamma-api.polymarket.com/events";
const PM_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
// Re-bootstrap token IDs from Gamma every few minutes so newly-listed
// fixtures get picked up without a redeploy. Cheap (single REST call).
const BOOTSTRAP_INTERVAL = 5 * 60_000;
// Broadcast no more than once per second — best_bid_ask fires ~1Hz per token,
// and batching drops needless client traffic.
const BROADCAST_THROTTLE = 1_000;

// Skip derivative event variants. `-more-markets` is kept because that's where
// the "Team to Advance" market lives.
const PM_VARIANT = /(exact-score|total-corners|player-props|both-teams-to-score)/;

// token_id → which match/side it represents.
interface TokenMeta {
	pairKey: string;
	teamIdx: number; // -1 for the draw token
}
const tokenIndex = new Map<string, TokenMeta>();
// pairKey → { home, away, draw } token IDs for assembling MatchOdds.
const pairTokens = new Map<string, { home?: string; away?: string; draw?: string }>();
// token_id → latest mid price (implied prob).
const tokenMids = new Map<string, number>();
// World Cup Winner market: tokenId → teamIdx (Yes outcome).
const winnerTokenIndex = new Map<string, number>();

let pmWs: WebSocket | null = null;
let pmPingTimer: ReturnType<typeof setInterval> | null = null;
let oddsDirty = false;
let oddsBroadcastTimer: ReturnType<typeof setTimeout> | null = null;

// ponytail: outcomes in a Team-to-Advance market are the team names directly
// (e.g. ["Germany","Paraguay"]), so we map each clobTokenId to its team.

// Pull WC fixtures from Gamma and rebuild token map. Idempotent; safe to
// call on a timer. New tokens get WS-subscribed on the next reconnect or
// via a dynamic subscribe if the socket is already open.
//
// ponytail: Gamma's default `volume24hr` sort is unstable across pages and
// cuts off fresh low-volume knockout markets (e.g. USA-BIH, BEL-SEN before
// they heat up). We paginate 4 offset pages and dedup by slug — covers
// ~120 fifwc events empirically. Swap to a slug-prefix query if Gamma ever
// adds one; bump page count if total fifwc events exceed ~400.
async function bootstrapTokens(): Promise<void> {
	try {
		const events: PmEvent[] = [];
		const seen = new Set<string>();
		for (const offset of [0, 100, 200, 300]) {
			const url =
				`${GAMMA_EVENTS_URL}?limit=100&offset=${offset}` +
				`&closed=false&order=volume24hr&ascending=false&tag_id=102232`;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const page = (await res.json()) as PmEvent[];
			if (!page.length) break;
			for (const ev of page) {
				if (ev.slug && !seen.has(ev.slug)) {
					seen.add(ev.slug);
					events.push(ev);
				}
			}
		}

		const newPairTokens = new Map<string, { home?: string; away?: string; draw?: string }>();
		const newTokenIndex = new Map<string, TokenMeta>();
		// tokenId → last-trade price (from outcomePrices). Seeds tokenMids so
		// odds render for newly-listed fixtures before any best_bid_ask fires.
		const newSeeds = new Map<string, number>();

		for (const ev of events) {
			if (!ev.slug.startsWith("fifwc-")) continue;
			if (PM_VARIANT.test(ev.slug)) continue;

			// `-more-markets` titles look like "Germany vs. Paraguay - More Markets";
			// strip the suffix before splitting on vs.
			const baseTitle = ev.title.replace(/\s+-\s+.*$/, "");
			const parts = baseTitle.split(/\s+vs\.?\s+/);
			if (parts.length !== 2) continue;
			const homeIdx = pmTeamIdx(parts[0]);
			const awayIdx = pmTeamIdx(parts[1]);
			if (homeIdx === null || awayIdx === null) continue;
			const key = pairKey(homeIdx, awayIdx);
			const entry: { home?: string; away?: string } = {};

			for (const m of ev.markets ?? []) {
				if (m.sportsMarketType !== "soccer_team_to_advance") continue;
				const outcomes = JSON.parse(m.outcomes) as string[];
				const clobIds = JSON.parse(m.clobTokenIds) as string[];
				let prices: string[] = [];
				try { prices = JSON.parse(m.outcomePrices) as string[]; } catch { /* none */ }
				for (let i = 0; i < outcomes.length; i++) {
					const idx = pmTeamIdx(outcomes[i]);
					const tid = clobIds[i];
					if (idx === null || !tid) continue;
					if (idx === homeIdx) { entry.home = tid; newTokenIndex.set(tid, { pairKey: key, teamIdx: homeIdx }); }
					else if (idx === awayIdx) { entry.away = tid; newTokenIndex.set(tid, { pairKey: key, teamIdx: awayIdx }); }
					const seedPrice = Number(prices[i]);
					if (Number.isFinite(seedPrice)) newSeeds.set(tid, seedPrice);
				}
			}
			if (entry.home && entry.away) newPairTokens.set(key, entry);
		}

		const added = [...newTokenIndex.keys()].filter((t) => !tokenIndex.has(t));
		const dropped = [...tokenIndex.keys()].filter((t) => !newTokenIndex.has(t));

		tokenIndex.clear();
		for (const [k, v] of newTokenIndex) tokenIndex.set(k, v);
		pairTokens.clear();
		for (const [k, v] of newPairTokens) pairTokens.set(k, v);
		for (const t of dropped) tokenMids.delete(t);

		// Seed implied probabilities from each market's last-trade price so
		// odds render immediately for newly-listed fixtures (e.g. a knockout
		// game posted after the WS opened) — before any best_bid_ask fires.
		// Live WS mids override these the moment a book update arrives.
		// Mirrors the World Cup Winner seeding in bootstrapWinnerTokens.
		let seeded = 0;
		for (const [tid, price] of newSeeds) {
			if (!tokenMids.has(tid)) { tokenMids.set(tid, price); seeded++; }
		}
		// Recompute every pair so seeded mids populate oddsCache.
		for (const key of pairTokens.keys()) {
			const updated = recomputePair(key);
			if (updated) oddsCache[key] = updated;
		}

		oddsError = null;
		console.log(
			`[odds] ${new Date().toISOString()} — bootstrap ${pairTokens.size} matches, ${tokenIndex.size} tokens (+${added.length} -${dropped.length}, seeded ${seeded})`,
		);

		if (seeded) scheduleOddsBroadcast();

		// Polymarket's market socket does not reliably honour a second
		// assets_ids message on an already-open connection, so newly-discovered
		// tokens never receive book updates. Close the socket — onopen
		// re-subscribes the full token set on reconnect, which is the only
		// path proven to deliver prices for fresh fixtures.
		if (added.length && pmWs?.readyState === WebSocket.OPEN) {
			pmWs.close();
		}
	} catch (e) {
		oddsError = e instanceof Error ? e.message : "Unknown error";
		console.error(`[odds] bootstrap failed: ${oddsError}`);
	}
}

// Bootstrap the World Cup Winner market (slug: world-cup-winner). Each
// sub-market is a Yes/No on one team; we take the Yes token and track its
// mid as that team's P(win WC). Used for champion-equity standings.
async function bootstrapWinnerTokens(): Promise<void> {
	try {
		const res = await fetch(`${GAMMA_EVENTS_URL}?slug=world-cup-winner`);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const events = (await res.json()) as PmEvent[];
		const ev = events[0];
		if (!ev?.markets?.length) return;

		const newIndex = new Map<string, number>();
		const seeded: Record<number, number> = {};
		for (const m of ev.markets) {
			const teamIdx = m.groupItemTitle != null ? pmTeamIdx(m.groupItemTitle) : null;
			if (teamIdx === null) continue;
			const outcomes = JSON.parse(m.outcomes) as string[];
			const clobIds = JSON.parse(m.clobTokenIds) as string[];
			const prices = JSON.parse(m.outcomePrices) as string[];
			const yesIdx = outcomes.findIndex((o) => o.toLowerCase() === "yes");
			if (yesIdx < 0) continue;
			const tid = clobIds[yesIdx];
			if (!tid) continue;
			newIndex.set(tid, teamIdx);
			const seed = Number(prices[yesIdx]);
			if (Number.isFinite(seed)) seeded[teamIdx] = seed;
		}

		const added = [...newIndex.keys()].filter((t) => !winnerTokenIndex.has(t));
		winnerTokenIndex.clear();
		for (const [tid, idx] of newIndex) winnerTokenIndex.set(tid, idx);
		// Seed initial probs from outcomePrices so the UI shows something
		// before the first best_bid_ask fires.
		for (const [idx, p] of Object.entries(seeded)) {
			if (winnerProbs[Number(idx)] === undefined) winnerProbs[Number(idx)] = p;
		}

		console.log(
			`[odds] ${new Date().toISOString()} — winner market: ${winnerTokenIndex.size} teams (+${added.length})`,
		);

		if (added.length && pmWs?.readyState === WebSocket.OPEN) {
			pmWs.send(JSON.stringify({
				assets_ids: added,
				type: "market",
				custom_feature_enabled: true,
			}));
			scheduleOddsBroadcast();
		}
	} catch (e) {
		console.error(`[odds] winner bootstrap failed: ${e instanceof Error ? e.message : "Unknown error"}`);
	}
}

// Recompute a pair's MatchOdds from stored token mids.
function recomputePair(key: string): MatchOdds | null {
	const entry = pairTokens.get(key);
	if (!entry?.home || !entry.away) return null;
	const homeMid = tokenMids.get(entry.home);
	const awayMid = tokenMids.get(entry.away);
	if (homeMid === undefined || awayMid === undefined) return null;
	const pcts: Record<number, number> = {};
	const homeMeta = tokenIndex.get(entry.home);
	const awayMeta = tokenIndex.get(entry.away);
	if (homeMeta) pcts[homeMeta.teamIdx] = homeMid;
	if (awayMeta) pcts[awayMeta.teamIdx] = awayMid;
	// Team-to-Advance has no draw outcome; always 0.
	return { pcts, draw: 0 };
}

// Update one token's mid, recompute its pair, mark dirty for broadcast.
function onTopOfBook(tokenId: string, bid: number, ask: number): void {
	if (!Number.isFinite(bid) || !Number.isFinite(ask)) return;
	const mid = (bid + ask) / 2;

	// World Cup Winner token?
	const winnerTeamIdx = winnerTokenIndex.get(tokenId);
	if (winnerTeamIdx !== undefined) {
		winnerProbs[winnerTeamIdx] = mid;
		oddsLastPoll = new Date();
		oddsError = null;
		scheduleOddsBroadcast();
		return;
	}

	const meta = tokenIndex.get(tokenId);
	if (!meta) return; // not a WC token (e.g. echo from a previous cycle)
	tokenMids.set(tokenId, mid);
	const updated = recomputePair(meta.pairKey);
	if (updated) {
		oddsCache[meta.pairKey] = updated;
		oddsLastPoll = new Date();
		oddsError = null;
		scheduleOddsBroadcast();
	}
}

function scheduleOddsBroadcast(): void {
	oddsDirty = true;
	if (oddsBroadcastTimer) return;
	oddsBroadcastTimer = setTimeout(() => {
		oddsBroadcastTimer = null;
		if (!oddsDirty) return;
		oddsDirty = false;
		broadcast({
			type: "odds",
			payload: { odds: oddsCache, winnerProbs, lastPoll: oddsLastPoll?.toISOString() ?? null },
		});
	}, BROADCAST_THROTTLE);
}

function connectPolymarketWS(): void {
	// Bun ships a native global WebSocket implementing the standard event API.
	pmWs = new WebSocket(PM_WS_URL);

	pmWs.onopen = () => {
		console.log(`[odds] ${new Date().toISOString()} — ws open`);
		oddsError = null;
		const ids = [...tokenIndex.keys(), ...winnerTokenIndex.keys()];
		if (ids.length) {
			pmWs!.send(JSON.stringify({
				assets_ids: ids,
				type: "market",
				custom_feature_enabled: true,
			}));
		}
		// Heartbeat per docs — server kills silent connections at ~10s.
		pmPingTimer = setInterval(() => {
			try { pmWs?.send("PING"); } catch { /* socket closing */ }
		}, 10_000);
	};

	pmWs.onmessage = (ev) => {
		const txt = typeof ev.data === "string" ? ev.data : "";
		if (txt === "PONG") return;
		let arr: unknown;
		try { arr = JSON.parse(txt); } catch { return; }
		const events = Array.isArray(arr) ? arr : [arr];
		for (const e of events as Array<Record<string, unknown>>) {
			const t = e.event_type;
			if (t === "best_bid_ask") {
				onTopOfBook(String(e.asset_id), Number(e.best_bid), Number(e.best_ask));
			} else if (t === "price_change") {
				// price_change carries per-change best_bid/best_ask too — useful
				// when best_bid_ask hasn't fired yet on a fresh subscription.
				for (const c of (e.price_changes as Array<Record<string, unknown>>) ?? []) {
					onTopOfBook(String(c.asset_id), Number(c.best_bid), Number(c.best_ask));
				}
			}
			// ponytail: ignore `book` (heavy initial snapshot), `last_trade_price`,
			// `new_market`, `market_resolved`. Add handling when a need shows up.
		}
	};

	pmWs.onclose = () => {
		console.log(`[odds] ${new Date().toISOString()} — ws closed, reconnecting in 3s`);
		if (pmPingTimer) { clearInterval(pmPingTimer); pmPingTimer = null; }
		pmWs = null;
		setTimeout(connectPolymarketWS, 3_000);
	};
	pmWs.onerror = (err) => {
		// Standard WebSocket error event carries a message in `event.message`
		// under Bun; fall back to the object itself for older runtimes.
		const msg = (err as { message?: string })?.message ?? "ws error";
		console.error(`[odds] ws error: ${msg}`);
		oddsError = msg;
	};
}

// Seed initial state, then keep the token map fresh.
void bootstrapTokens().then(() => connectPolymarketWS());
void bootstrapWinnerTokens();
setInterval(bootstrapTokens, BOOTSTRAP_INTERVAL);
setInterval(bootstrapWinnerTokens, BOOTSTRAP_INTERVAL);

// ── Elysia app ───────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const app = new Elysia()
	.use(cors())
	.get("/api/results", () => buildResults())
	.post("/api/poll", async () => {
		await pollESPN();
		return buildResults();
	})
	.post("/api/seed", ({ body, set }) => {
		const input = body as {
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
		if (!Array.isArray(input?.matches)) {
			set.status = 400;
			return { error: "Expected { matches: [...] }" };
		}
		upsertMany(input.matches.map((m) => ({
			matchId: `${m.home_idx}v${m.away_idx}`,
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
		})));
		console.log(`[seed] inserted ${input.matches.length} match(es)`);
		return buildResults();
	})
	.get("/api/odds", () => ({
		odds: oddsCache,
		winnerProbs,
		lastPoll: oddsLastPoll?.toISOString() ?? null,
		error: oddsError,
	}))
	.get("/api/health", () => {
		const storedMatches = db.select().from(results).all().length;
		return {
			status: "ok",
			db: DB_PATH,
			storedMatches,
			liveMatches: liveCache.length,
			lastPoll: lastPollTime?.toISOString() ?? null,
			error: pollError,
			oddsLastPoll: oddsLastPoll?.toISOString() ?? null,
			oddsError,
			pmWs: pmWs?.readyState === WebSocket.OPEN ? "open" : "closed",
		};
	})
	// One socket per browser: full snapshot on connect, then deltas whenever
	// ESPN poll or odds recompute. Frontend falls back to REST poll if the
	// socket won't stay open.
	.ws("/ws", {
		open(ws) {
			clients.add(ws);
			ws.send(JSON.stringify({
				type: "snapshot",
				matches: buildResults(),
				odds: { odds: oddsCache, winnerProbs, lastPoll: oddsLastPoll?.toISOString() ?? null },
			}));
		},
		close(ws) { clients.delete(ws); },
		message() { /* client→server not used */ },
	})
	.listen(PORT, () => {
		console.log(`[wc-api] listening on :${PORT}`);
		console.log(`[wc-api] db=${DB_PATH}`);
	});

// One socket per browser tracked in a Set so we can fan out deltas
// without depending on Elysia's topic pub/sub typing.
const clients = new Set<WsClient>();
function broadcast(msg: unknown): void {
	const data = JSON.stringify(msg);
	for (const c of clients) {
		if (c.readyState === 1) c.send(data);
	}
}
// broadcastMatches → every browser connected on /ws.
function broadcastMatches(): void {
	broadcast({ type: "matches", payload: buildResults() });
}
