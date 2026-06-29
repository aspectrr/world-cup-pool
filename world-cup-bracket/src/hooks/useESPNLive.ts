import { useState, useEffect, useCallback, useRef } from "react";

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

export interface LiveData {
	matches: ServerMatch[];
	lastUpdated: Date | null;
	loading: boolean;
	error: string | null;
	fetchNow: () => void;
}

// During dev: proxied through Vite to localhost:3000
// In prod: API is on Fly.io, CORS-enabled
const API_BASE = import.meta.env.VITE_API_URL ?? "";
const POLL_INTERVAL = 30_000; // 30s — server polls ESPN, we poll server

// SWR cache: hydrate from localStorage on mount so refreshes render last-known
// data instantly instead of flashing an empty/loading state. Cold first-visit
// still loads from network; subsequent refreshes show stale → swap to fresh.
const CACHE_KEY = "wc2026:results:v1";

interface CachedResults {
	matches: ServerMatch[];
	savedAt: string; // ISO timestamp
}

function readCache(): CachedResults | null {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as CachedResults;
		if (!Array.isArray(parsed.matches)) return null;
		return parsed;
	} catch {
		return null;
	}
}

function writeCache(matches: ServerMatch[]): void {
	try {
		localStorage.setItem(
			CACHE_KEY,
			JSON.stringify({ matches, savedAt: new Date().toISOString() }),
		);
	} catch {
		// quota / private mode — caching is best-effort
	}
}

async function fetchResults(): Promise<ResultsResponse> {
	const res = await fetch(`${API_BASE}/api/results`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

export function useESPNLive(): LiveData {
	// Hydrate from cache synchronously so the first paint shows real data.
	// Lazy initializers keep readCache() off the hot render path.
	const [matches, setMatches] = useState<ServerMatch[]>(() => readCache()?.matches ?? []);
	const [lastUpdated, setLastUpdated] = useState<Date | null>(() => {
		const c = readCache();
		return c ? new Date(c.savedAt) : null;
	});
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchNow = useCallback(() => {
		setLoading(true);
		setError(null);
		fetchResults()
			.then((data) => {
				setMatches(data.matches);
				const now = new Date();
				setLastUpdated(now);
				writeCache(data.matches);
				if (data.error) setError(data.error);
			})
			.catch((e) => {
				setError(e instanceof Error ? e.message : "Failed to fetch");
			})
			.finally(() => {
				setLoading(false);
			});
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => fetchNow(), 0);
		intervalRef.current = setInterval(fetchNow, POLL_INTERVAL);
		return () => {
			clearTimeout(timer);
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [fetchNow]);

	return { matches, lastUpdated, loading, error, fetchNow };
}
