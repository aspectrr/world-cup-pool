import { useState, useEffect, useCallback, useRef } from "react";
import type { ESPNMatch } from "../data/espn";
import { parseESMNScoreboard } from "../data/espn";

const SCOREBOARD_URL =
	"https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard";
const POLL_INTERVAL = 60_000; // 60s

export interface LiveData {
	matches: ESPNMatch[];
	lastUpdated: Date | null;
	loading: boolean;
	error: string | null;
	fetchNow: () => void;
}

async function fetchScoreboard(): Promise<ESPNMatch[]> {
	const res = await fetch(SCOREBOARD_URL);
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	const json = await res.json();
	return parseESMNScoreboard(json);
}

export function useESPNLive(enabled = true): LiveData {
	const [matches, setMatches] = useState<ESPNMatch[]>([]);
	const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const fetchNow = useCallback(() => {
		setLoading(true);
		setError(null);
		fetchScoreboard()
			.then((parsed) => {
				setMatches(parsed);
				setLastUpdated(new Date());
			})
			.catch((e) => {
				setError(e instanceof Error ? e.message : "Failed to fetch");
			})
			.finally(() => {
				setLoading(false);
			});
	}, []);

	useEffect(() => {
		if (!enabled) return;

		// Initial fetch via setTimeout to avoid synchronous setState in effect
		const timer = setTimeout(() => fetchNow(), 0);
		intervalRef.current = setInterval(fetchNow, POLL_INTERVAL);

		return () => {
			clearTimeout(timer);
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [enabled, fetchNow]);

	return { matches, lastUpdated, loading, error, fetchNow };
}
