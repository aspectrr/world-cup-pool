import { useState, useEffect, useCallback } from "react";
import type { Tab, GroupMatch, KnockoutMatch } from "./types";
import { generateGroupMatches, generateKnockoutMatches } from "./data/bracket";
import { GROUP_SCHEDULE } from "./data/schedule";
import { useESPNLive } from "./hooks/useESPNLive";
import { Standings } from "./components/Standings";
import { GroupsView } from "./components/GroupsView";
import { GamesView } from "./components/GamesView";
import { BracketView } from "./components/BracketView";
import { MyTeams } from "./components/MyTeams";

const HASH_MAP: Record<string, Tab> = {
	"": "standings",
	standings: "standings",
	groups: "groups",
	games: "games",
	bracket: "bracket",
	"my-teams": "my-teams",
};
const TAB_HASH: Record<Tab, string> = {
	standings: "standings",
	groups: "groups",
	games: "games",
	bracket: "bracket",
	"my-teams": "my-teams",
};

function tabFromHash(): Tab {
	const h = window.location.hash.replace("#", "");
	return HASH_MAP[h] ?? "standings";
}

// Apply schedule dates to group matches
const initGroupMatches = generateGroupMatches().map((m) => ({
	...m,
	date: GROUP_SCHEDULE[m.id],
}));
const initKnockoutMatches = generateKnockoutMatches();

export default function App() {
	const [tab, setTab] = useState<Tab>(tabFromHash);

	// Sync tab → URL
	const navigate = useCallback((t: Tab) => {
		setTab(t);
		window.location.hash = TAB_HASH[t];
	}, []);

	// Sync URL → tab (back/forward nav)
	useEffect(() => {
		const onHash = () => setTab(tabFromHash());
		window.addEventListener("hashchange", onHash);
		return () => window.removeEventListener("hashchange", onHash);
	}, []);
	const [gMatches, setGMatches] = useState<GroupMatch[]>(initGroupMatches);
	const [kMatches, setKMatches] =
		useState<KnockoutMatch[]>(initKnockoutMatches);
	const live = useESPNLive(true);

	// Merge ESPN live data into group matches (source of truth)
	useEffect(() => {
		if (live.matches.length === 0) return;

		// eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external API data via functional updater
		setGMatches((prev) => {
			let changed = false;
			const updated = prev.map((m) => {
				const espn = live.matches.find(
					(e) =>
						(e.homeIdx === m.homeIdx && e.awayIdx === m.awayIdx) ||
						(e.homeIdx === m.awayIdx && e.awayIdx === m.homeIdx),
				);
				if (!espn) return m;

				const isReversed = espn.homeIdx === m.awayIdx;
				const homeScore = isReversed ? espn.awayScore : espn.homeScore;
				const awayScore = isReversed ? espn.homeScore : espn.awayScore;
				const played = espn.status === "finished";

				if (
					m.status === espn.status &&
					m.played === played &&
					m.homeScore === homeScore &&
					m.awayScore === awayScore
				) {
					return m;
				}

				changed = true;
				return {
					...m,
					homeScore,
					awayScore,
					played,
					status: espn.status,
					clock: espn.clock,
					date: espn.date,
				};
			});

			return changed ? updated : prev;
		});
	}, [live.matches]);

	const liveCount = gMatches.filter((m) => m.status === "live").length;

	return (
		<div className="app">
			<header className="header">
				<h1>World Cup 2026</h1>
				<div className="subtitle">
					Pool Tracker
					{live.loading && <span className="live-sync">↻</span>}
					{liveCount > 0 && (
						<span className="live-badge">
							<span className="live-dot" /> {liveCount} LIVE
						</span>
					)}
				</div>
			</header>

			<nav className="tabs">
				<button
					className={`tab-btn${tab === "standings" ? " active" : ""}`}
					onClick={() => navigate("standings")}
				>
					Standings
				</button>
				<button
					className={`tab-btn${tab === "groups" ? " active" : ""}`}
					onClick={() => navigate("groups")}
				>
					Groups
				</button>
				<button
					className={`tab-btn${tab === "games" ? " active" : ""}`}
					onClick={() => navigate("games")}
				>
					Games
				</button>
				<button
					className={`tab-btn${tab === "bracket" ? " active" : ""}`}
					onClick={() => navigate("bracket")}
				>
					Bracket
				</button>
				<button
					className={`tab-btn${tab === "my-teams" ? " active" : ""}`}
					onClick={() => navigate("my-teams")}
				>
					My Teams
				</button>
			</nav>

			{live.lastUpdated && (
				<div className="last-updated" onClick={live.fetchNow}>
					Updated {live.lastUpdated.toLocaleTimeString()}{" "}
					{live.error && `• ${live.error}`}
				</div>
			)}

			{tab === "standings" && (
				<Standings gMatches={gMatches} kMatches={kMatches} />
			)}
			{tab === "groups" && <GroupsView />}
			{tab === "games" && <GamesView gMatches={gMatches} kMatches={kMatches} />}
			{tab === "bracket" && (
				<BracketView
					matches={kMatches}
					setMatches={setKMatches}
					gMatches={gMatches}
				/>
			)}
			{tab === "my-teams" && (
				<MyTeams gMatches={gMatches} kMatches={kMatches} />
			)}
		</div>
	);
}
