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

async function fetchResults(): Promise<ResultsResponse> {
	const res = await fetch(`${API_BASE}/api/results`);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

export function useESPNLive(): LiveData {
	const [matches, setMatches] = useState<ServerMatch[]>([]);
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchNow = useCallback(() => {
		setLoading(true);
		setError(null);
		fetchResults()
			.then((data) => {
				setMatches(data.matches);
				setLastUpdated(new Date());
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
