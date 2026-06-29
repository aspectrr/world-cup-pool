import { useState, useEffect, useCallback, useRef } from "react";

// Polymarket implied probabilities per match. The backend canonicalizes the
// pair key by team-idx order (a < b), so the same key works regardless of
// which side is "home" in our schedule. Knockout games have no draw market.
export interface MatchOdds {
	pcts: Record<number, number>; // teamIdx → implied win prob (0..1)
	draw: number; // implied draw prob (0..1)
}

export interface OddsResponse {
	odds: Record<string, MatchOdds>;
	lastPoll: string | null;
	error: string | null;
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";
const POLL_INTERVAL = 60_000; // backend polls Polymarket every 60s

/** Canonical pair key — order-independent so callers don't worry about home/away. */
export function oddsKey(a: number, b: number): string {
	return a < b ? `${a}v${b}` : `${b}v${a}`;
}

export function useOdds() {
	const [odds, setOdds] = useState<Record<string, MatchOdds>>({});
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchNow = useCallback(() => {
		setLoading(true);
		setError(null);
		fetch(`${API_BASE}/api/odds`)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.json() as Promise<OddsResponse>;
			})
			.then((data) => {
				setOdds(data.odds ?? {});
				setLastUpdated(new Date());
				if (data.error) setError(data.error);
			})
			.catch((e) => {
				setError(e instanceof Error ? e.message : "Failed to fetch");
			})
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		const timer = setTimeout(fetchNow, 1500); // stagger vs ESPN poll
		intervalRef.current = setInterval(fetchNow, POLL_INTERVAL);
		return () => {
			clearTimeout(timer);
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [fetchNow]);

	return { odds, lastUpdated, loading, error, fetchNow };
}
