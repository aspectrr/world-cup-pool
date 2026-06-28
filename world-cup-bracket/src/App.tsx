import { useState, useEffect, useCallback, useMemo } from "react";
import type { Tab, GroupMatch, KnockoutMatch } from "./types";
import { generateGroupMatches, generateKnockoutMatches } from "./data/bracket";
import { GROUP_SCHEDULE, KNOCKOUT_SCHEDULE } from "./data/schedule";
import { useESPNLive } from "./hooks/useESPNLive";
import type { ServerMatch } from "./hooks/useESPNLive";
import { Standings } from "./components/Standings";
import { GroupsView } from "./components/GroupsView";
import { GamesView } from "./components/GamesView";
import { BracketView } from "./components/BracketView";
import { MyTeams } from "./components/MyTeams";
import { getAdvancingTeams, getClinchedGroupWinners } from "./utils/standings";

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
// Apply static schedule to knockout matches so dates show before ESPN lists them
const initKnockoutMatches = generateKnockoutMatches().map((m) => ({
	...m,
	date: KNOCKOUT_SCHEDULE[m.id] ?? m.date,
}));

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
	const live = useESPNLive();

	// Merge server results into group matches
	useEffect(() => {
		if (live.matches.length === 0) return;

		// Build lookup: "homeIdx v awayIdx" OR "awayIdx v homeIdx" → server match
		const byTeams = new Map<string, ServerMatch>();
		for (const sm of live.matches) {
			byTeams.set(`${sm.home_idx}v${sm.away_idx}`, sm);
			byTeams.set(`${sm.away_idx}v${sm.home_idx}`, sm);
		}

		// eslint-disable-next-line react-hooks/set-state-in-effect -- syncing external API data via functional updater
		setGMatches((prev) => {
			let changed = false;
			const updated = prev.map((m) => {
				const sm = byTeams.get(`${m.homeIdx}v${m.awayIdx}`);
				if (!sm) return m;

				const isReversed = sm.home_idx === m.awayIdx;
				const homeScore = isReversed ? sm.away_score : sm.home_score;
				const awayScore = isReversed ? sm.home_score : sm.away_score;
				const played = sm.status === "finished" || sm.status === "live";

				if (
					m.status === sm.status &&
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
					status: sm.status,
					clock: sm.clock,
					date: sm.date,
				};
			});

			return changed ? updated : prev;
		});

		// Merge live results into knockout matches. Server keys by team-idx pair
		// with no round discriminator, so a group-stage result (pre-Jun-28) could
		// collide with a later knockout matchup of the same teams. Filter server
		// entries to the knockout window to avoid that.
		const R32_START = "2026-06-28T00:00:00Z";
		setKMatches((prev) => {
			let changed = false;
			const updated = prev.map((m) => {
				if (m.homeIdx === null || m.awayIdx === null) return m;
				const sm = byTeams.get(`${m.homeIdx}v${m.awayIdx}`);
				if (!sm || sm.date < R32_START) return m;

				const isReversed = sm.home_idx === m.awayIdx;
				const homeScore = isReversed ? sm.away_score : sm.home_score;
				const awayScore = isReversed ? sm.home_score : sm.away_score;
				const played = sm.status === "finished" || sm.status === "live";

				if (
					m.status === sm.status &&
					m.played === played &&
					m.homeScore === homeScore &&
					m.awayScore === awayScore &&
					m.clock === sm.clock &&
					m.date === sm.date
				) {
					return m;
				}

				changed = true;
				return {
					...m,
					homeScore,
					awayScore,
					played,
					status: sm.status,
					clock: sm.clock,
					date: sm.date,
				};
			});

			return changed ? updated : prev;
		});
	}, [live.matches]);

	const liveCount = gMatches.filter((m) => m.status === "live").length;

	// Team indices currently in a live game — used to flag bracket slots.
	const liveTeamIdxs = useMemo(
		() =>
			new Set(
				live.matches
					.filter((m) => m.status === "live")
					.flatMap((m) => [m.home_idx, m.away_idx]),
			),
		[live.matches],
	);

	// Group stage is over once every group match has been played
	const groupStageDone = gMatches.length > 0 && gMatches.every((m) => m.played);

	// Teams advancing to R32: live snapshot during group stage (top-2 + best
	// 8 thirds on current form), final answer once groups are done. Used to
	// highlight advancing rows in GroupsView and MyTeams position badges.
	const advancing = useMemo(
		() => getAdvancingTeams(gMatches),
		[gMatches],
	);

	// Teams that have mathematically clinched 1st in their group — lets us
	// surface the Bracket tab and seed R32 winner slots before group stage ends.
	const clinchedWinners = useMemo(
		() => getClinchedGroupWinners(gMatches),
		[gMatches],
	);

	// Bracket tab is visible once any group winner has clinched OR the group
	// stage is complete. If user lands on bracket before either, fall back.
	const showBracket = clinchedWinners.size > 0 || groupStageDone;
	const effectiveTab: Tab =
		!showBracket && tab === "bracket" ? "standings" : tab;

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
					className={`tab-btn${effectiveTab === "standings" ? " active" : ""}`}
					onClick={() => navigate("standings")}
				>
					Standings
				</button>
				<button
					className={`tab-btn${effectiveTab === "groups" ? " active" : ""}`}
					onClick={() => navigate("groups")}
				>
					Groups
				</button>
				<button
					className={`tab-btn${effectiveTab === "games" ? " active" : ""}`}
					onClick={() => navigate("games")}
				>
					Games
				</button>
				{showBracket && (
					<button
						className={`tab-btn${effectiveTab === "bracket" ? " active" : ""}`}
						onClick={() => navigate("bracket")}
					>
						Bracket
					</button>
				)}
				<button
					className={`tab-btn${effectiveTab === "my-teams" ? " active" : ""}`}
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

			{effectiveTab === "standings" && (
				<Standings gMatches={gMatches} kMatches={kMatches} />
			)}
			{effectiveTab === "groups" && (
				<GroupsView matches={gMatches} advancing={advancing} />
			)}
			{effectiveTab === "games" && (
				<GamesView gMatches={gMatches} kMatches={kMatches} />
			)}
			{effectiveTab === "bracket" && (
				<BracketView
					matches={kMatches}
					setMatches={setKMatches}
					gMatches={gMatches}
					clinchedWinners={clinchedWinners}
					liveTeamIdxs={liveTeamIdxs}
				/>
			)}
			{effectiveTab === "my-teams" && (
				<MyTeams
					gMatches={gMatches}
					kMatches={kMatches}
					advancing={advancing}
				/>
			)}
		</div>
	);
}
