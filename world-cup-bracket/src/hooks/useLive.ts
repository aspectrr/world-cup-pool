import { useState, useEffect, useCallback, useRef } from "react";

// Single hook replacing useESPNLive + useOdds. Backend pushes both feeds
// over one WebSocket at /ws; we hydrate from localStorage for cold-start,
// REST-boot on mount, and fall back to REST polling if the socket drops.

export interface ServerMatch {
	match_id: string;
	espn_id: string | null;
	home_idx: number;
	away_idx: number;
	home_score: number;
	away_score: number;
	status: "scheduled" | "live" | "finished";
	clock: string;
	date: string;
	winner_idx: number | null;
	detail: string;
}

export interface ResultsResponse {
	matches: ServerMatch[];
	lastPoll: string | null;
	error: string | null;
}

export interface MatchOdds {
	pcts: Record<number, number>; // teamIdx → implied win prob (0..1)
	draw: number; // implied draw prob (0..1)
}

export interface OddsPayload {
	odds: Record<string, MatchOdds>;
	lastPoll: string | null;
}

export interface OddsResponse extends OddsPayload {
	error: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const WS_BASE = (() => {
	if (API_BASE) {
		return API_BASE.replace(/^http/, "ws");
	}
	// No API_BASE = dev, same origin via vite proxy.
	return `ws://${location.hostname}:3000`;
})();
const WS_URL = `${WS_BASE}/ws`;

// Backend canonicalizes the pair key by team-idx order (a < b), so callers
// don't worry about home/away.
export function oddsKey(a: number, b: number): string {
	return a < b ? `${a}v${b}` : `${b}v${a}`;
}

// ── localStorage SWR cache (instant hydrate on reload) ───────────────

const MATCHES_KEY = "wc2026:results:v1";
const ODDS_KEY = "wc2026:odds:v1";

function readMatchesCache(): ServerMatch[] | null {
	try {
		const raw = localStorage.getItem(MATCHES_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { matches?: ServerMatch[] } | ServerMatch[];
		return Array.isArray(parsed) ? parsed : (parsed.matches ?? null);
	} catch {
		return null;
	}
}

function readOddsCache(): { odds: Record<string, MatchOdds>; savedAt: string } | null {
	try {
		const raw = localStorage.getItem(ODDS_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { odds?: Record<string, MatchOdds>; savedAt?: string };
		if (!parsed.odds) return null;
		return { odds: parsed.odds, savedAt: parsed.savedAt ?? "" };
	} catch {
		return null;
	}
}

function writeMatchesCache(matches: ServerMatch[]): void {
	try {
		localStorage.setItem(MATCHES_KEY, JSON.stringify({ matches, savedAt: new Date().toISOString() }));
	} catch { /* quota / private mode */ }
}

function writeOddsCache(odds: Record<string, MatchOdds>): void {
	try {
		localStorage.setItem(ODDS_KEY, JSON.stringify({ odds, savedAt: new Date().toISOString() }));
	} catch { /* best-effort */ }
}

// ── REST fetchers (bootstrap + fallback) ─────────────────────────────

async function fetchResults(): Promise<ResultsResponse> {
	const res = await fetch(`${API_BASE}/api/results`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json() as Promise<ResultsResponse>;
}

async function fetchOdds(): Promise<OddsResponse> {
	const res = await fetch(`${API_BASE}/api/odds`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json() as Promise<OddsResponse>;
}

// ── Hook ─────────────────────────────────────────────────────────────

export interface LiveData {
	matches: ServerMatch[];
	odds: Record<string, MatchOdds>;
	lastUpdated: Date | null;
	loading: boolean;
	error: string | null;
	connected: boolean;
	fetchNow: () => void;
}

const RECONNECT_MIN = 1_000;
const RECONNECT_MAX = 15_000;
const FALLBACK_POLL = 30_000;

export function useLive(): LiveData {
	const [matches, setMatches] = useState<ServerMatch[]>(() => readMatchesCache() ?? []);
	const [odds, setOdds] = useState<Record<string, MatchOdds>>(() => readOddsCache()?.odds ?? {});
	const cachedAt = readOddsCache()?.savedAt ?? readMatchesCacheSaveAt();
	const [lastUpdated, setLastUpdated] = useState<Date | null>(() =>
		cachedAt ? new Date(cachedAt) : null,
	);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [connected, setConnected] = useState(false);

	const wsRef = useRef<WebSocket | null>(null);
	const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const reconnectDelay = useRef(RECONNECT_MIN);

	// Pull both feeds over REST. Used for the initial mount and as the
	// fallback when the socket isn't open.
	const fetchNow = useCallback(() => {
		setLoading(true);
		setError(null);
		Promise.all([fetchResults(), fetchOdds()])
			.then(([r, o]) => {
				setMatches(r.matches);
				writeMatchesCache(r.matches);
				setOdds(o.odds ?? {});
				writeOddsCache(o.odds ?? {});
				setLastUpdated(new Date());
				const err = r.error ?? o.error;
				if (err) setError(err);
			})
			.catch((e) => setError(e instanceof Error ? e.message : "Failed to fetch"))
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		// Cold-start: REST first so we render even if WS is blocked/broken.
		// Deferred a tick so setState inside fetchNow doesn't fire mid-effect.
		const bootTimer = setTimeout(fetchNow, 0);

		let closedByUs = false;
		let fallbackTimer: ReturnType<typeof setInterval> | null = null;

		const connect = () => {
			const ws = new WebSocket(WS_URL);
			wsRef.current = ws;

			ws.onopen = () => {
				setConnected(true);
				reconnectDelay.current = RECONNECT_MIN;
			};

			ws.onmessage = (ev) => {
				let msg: { type?: string; matches?: ResultsResponse; odds?: OddsPayload; payload?: unknown };
				try {
					msg = JSON.parse(ev.data as string);
				} catch {
					return;
				}
				if (msg.type === "snapshot") {
					const r = msg.matches;
					const o = msg.odds;
					if (r) {
						setMatches(r.matches);
						writeMatchesCache(r.matches);
					}
					if (o) {
						setOdds(o.odds ?? {});
						writeOddsCache(o.odds ?? {});
					}
					setLastUpdated(new Date());
					setError(null);
					setLoading(false);
				} else if (msg.type === "matches" && msg.payload) {
					const r = msg.payload as ResultsResponse;
					setMatches(r.matches);
					writeMatchesCache(r.matches);
					setLastUpdated(new Date());
				} else if (msg.type === "odds" && msg.payload) {
					const o = msg.payload as OddsPayload;
					setOdds(o.odds ?? {});
					writeOddsCache(o.odds ?? {});
					setLastUpdated(new Date());
				}
			};

			ws.onclose = () => {
				setConnected(false);
				wsRef.current = null;
				if (closedByUs) return;
				// Exponential backoff with cap.
				const delay = reconnectDelay.current;
				reconnectDelay.current = Math.min(RECONNECT_MAX, delay * 2);
				reconnectRef.current = setTimeout(connect, delay);
			};

			ws.onerror = () => {
				// Let onclose handle reconnect; just clear the broken socket.
				try { ws.close(); } catch { /* noop */ }
			};
		};

		connect();

		// REST fallback: poll only when the socket isn't carrying data.
		// Keeps the page live if WS is firewalled or repeatedly dying.
		fallbackTimer = setInterval(() => {
			if (wsRef.current?.readyState === WebSocket.OPEN) return;
			fetchResults()
				.then((r) => { setMatches(r.matches); writeMatchesCache(r.matches); setLastUpdated(new Date()); })
				.catch(() => { /* the loading/error path handles user feedback */ });
			fetchOdds()
				.then((o) => { setOdds(o.odds ?? {}); writeOddsCache(o.odds ?? {}); })
				.catch(() => { /* ditto */ });
		}, FALLBACK_POLL);

		return () => {
			closedByUs = true;
			clearTimeout(bootTimer);
			if (reconnectRef.current) clearTimeout(reconnectRef.current);
			if (fallbackTimer) clearInterval(fallbackTimer);
			try { wsRef.current?.close(); } catch { /* noop */ }
		};
	}, [fetchNow]);

	return { matches, odds, lastUpdated, loading, error, connected, fetchNow };
}

// Lazy init helper: read the matches cache's savedAt without re-parsing twice.
function readMatchesCacheSaveAt(): string | null {
	try {
		const raw = localStorage.getItem(MATCHES_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as { savedAt?: string };
		return parsed.savedAt ?? null;
	} catch {
		return null;
	}
}
