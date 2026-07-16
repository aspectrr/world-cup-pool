import { useState, useEffect, useCallback, useMemo } from "react";
import type { Tab, GroupMatch, KnockoutMatch } from "./types";
import {
	generateGroupMatches,
	generateKnockoutMatches,
	populateR32,
	R32_SLOTS,
	seedLabel,
	type SeedSpec,
} from "./data/bracket";
import { GROUP_SCHEDULE, KNOCKOUT_SCHEDULE } from "./data/schedule";
import { useLive } from "./hooks/useLive";
import type { ServerMatch } from "./hooks/useLive";
import { Standings } from "./components/Standings";
import { GamesView } from "./components/GamesView";
import { BracketView } from "./components/BracketView";
import { MyTeams } from "./components/MyTeams";
import { Skeleton } from "./components/Skeleton";
import { getAdvancingTeams, getClinchedGroupWinners } from "./utils/standings";
import { TEAMS } from "./data/teams";

const HASH_MAP: Record<string, Tab> = {
	"": "standings",
	standings: "standings",
	games: "games",
	bracket: "bracket",
	"my-teams": "my-teams",
};
const TAB_HASH: Record<Tab, string> = {
	standings: "standings",
	games: "games",
	bracket: "bracket",
	"my-teams": "my-teams",
};

function groupLetterOf(idx: number | null): string | null {
	if (idx === null) return null;
	return TEAMS[idx].group;
}

// When the seed is a third-place slot, return the resolved group letter;
// otherwise return null (the label ignores it for winner/runner specs).
function groupLetterOfIfThird(spec: SeedSpec, tg: string | null): string | null {
	return spec.kind === "3" ? tg : null;
}

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
	const live = useLive();

	// Merge server results into group matches only — knockout matches are
	// derived (below) so populateR32 + live scores resolve in a single render
	// instead of cascading through two setKMatches effects.
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
	}, [live.matches]);

	const liveCount = gMatches.filter((m) => m.status === "live").length;

	// Group stage is over once every group match has been played
	const groupStageDone = gMatches.length > 0 && gMatches.every((m) => m.played);

	// Teams advancing to R32: live snapshot during group stage (top-2 + best
	// 8 thirds on current form), final answer once groups are done. Used to
	// highlight advancing rows in MyTeams position badges.
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

	// Knockout matches derived in a single pass: R32 seeded from group results
	// via populateR32, then live scores/status/clock merged from the server.
	// Previously this was split across two setKMatches effects that cascaded —
	// live merge ran before populateR32 filled homeIdx/awayIdx, so R32 scores
	// only appeared on the next 30s poll. Deriving here resolves both in one
	// render so the bracket is current as soon as data lands.
	const kMatches = useMemo<KnockoutMatch[]>(() => {
		const r32 = populateR32(gMatches, clinchedWinners);

		// Re-seed labels too (third-place slots resolve once groups end).
		// ponytail: assumes R32_SLOTS ordering matches generateKnockoutMatches.
		const thirdGroupFor = new Map<string, string | null>();
		for (const slot of R32_SLOTS) {
			const filled = r32.get(slot.id);
			thirdGroupFor.set(
				slot.id,
				filled && slot.home.kind === "3"
					? groupLetterOf(filled[0])
					: filled && slot.away.kind === "3"
						? groupLetterOf(filled[1])
						: null,
			);
		}

		// Server lookup by team-idx pair (both directions).
		const byTeams = new Map<string, ServerMatch>();
		for (const sm of live.matches) {
			byTeams.set(`${sm.home_idx}v${sm.away_idx}`, sm);
			byTeams.set(`${sm.away_idx}v${sm.home_idx}`, sm);
		}
		const R32_START = "2026-06-28T00:00:00Z";

		// Walk matches in array order (R32 → FINAL → THIRD) so winners AND
		// losers register before downstream matches that reference them via
		// "Winner MXX" / "Loser MXX" seed labels.
		const winnerOf = new Map<string, number | null>();
		const loserOf = new Map<string, number | null>();

		// Merge a server result into a resolved matchup. Returns the patch fields
		// (or null if no server data for this pairing).
		const mergeLive = (
			homeIdx: number,
			awayIdx: number,
		): Partial<KnockoutMatch> | null => {
			const sm = byTeams.get(`${homeIdx}v${awayIdx}`);
			if (!sm || sm.date < R32_START) return null;
			const isReversed = sm.home_idx === awayIdx;
			const homeScore = isReversed ? sm.away_score : sm.home_score;
			const awayScore = isReversed ? sm.home_score : sm.away_score;
			const played = sm.status === "finished" || sm.status === "live";
			return {
				homeScore,
				awayScore,
				played,
				status: sm.status,
				clock: sm.clock,
				date: sm.date,
				winnerIdx: sm.winner_idx,
				detail: sm.detail,
			};
		};

		// Resolve the winner team idx of a built match. Prefers ESPN's explicit
		// winner flag (set for ET/pen wins where regulation score is tied),
		// falls back to score difference. Null for unplayed/live/drawn.
		const resolveWinner = (b: KnockoutMatch): number | null => {
			if (
				!b.played ||
				b.homeScore === null ||
				b.awayScore === null ||
				b.status === "live"
			)
				return null;
			if (b.winnerIdx !== null && b.winnerIdx !== undefined) return b.winnerIdx;
			if (b.homeScore > b.awayScore) return b.homeIdx;
			if (b.awayScore > b.homeScore) return b.awayIdx;
			return null;
		};

		// Loser of a played knockout match — the OTHER competitor from the
		// winner. Feeds the third-place play-off (M103 = Loser M101 v Loser M102).
		const resolveLoser = (b: KnockoutMatch): number | null => {
			const w = resolveWinner(b);
			if (w === null || b.homeIdx === null || b.awayIdx === null) return null;
			return w === b.homeIdx ? b.awayIdx : b.homeIdx;
		};

		return initKnockoutMatches.map((m): KnockoutMatch => {
			if (m.round === "R32") {
				const slot = R32_SLOTS.find((s) => s.id === m.id);
				if (!slot) return m;
				const filled = r32.get(m.id);
				if (!filled) return m;
				const [homeIdx, awayIdx] = filled;
				const tg = thirdGroupFor.get(m.id) ?? null;
				const homeSeed = seedLabel(slot.home, groupLetterOfIfThird(slot.home, tg));
				const awaySeed = seedLabel(slot.away, groupLetterOfIfThird(slot.away, tg));
				const base: KnockoutMatch = { ...m, homeIdx, awayIdx, homeSeed, awaySeed };
				if (homeIdx !== null && awayIdx !== null) {
					const live = mergeLive(homeIdx, awayIdx);
					if (live) Object.assign(base, live);
				}
				// Register winner for downstream matches. Must use resolveWinner
				// (not raw score comparison) so penalty/ET wins — where regulation
				// score is tied but ESPN sets winnerIdx — propagate to the next round.
				winnerOf.set(m.id, resolveWinner(base));
				loserOf.set(m.id, resolveLoser(base));
				return base;
			}

			// R16/QF/SF/FINAL/THIRD: feeders referenced via "Winner MXX" or
			// "Loser MXX" seeds (THIRD = SF losers). Fill each slot independently
			// so a resolved team shows immediately even before its opponent is known.
			const resolveSeed = (seed: string): number | null => {
				const sm = seed.match(/(Winner|Loser) (\w+)/);
				if (!sm) return null;
				const [, kind, feederId] = sm;
				return (kind === "Loser" ? loserOf : winnerOf).get(feederId) ?? null;
			};
			const homeIdx = resolveSeed(m.homeSeed);
			const awayIdx = resolveSeed(m.awaySeed);
			const base: KnockoutMatch = { ...m };
			if (homeIdx !== null) base.homeIdx = homeIdx;
			if (awayIdx !== null) base.awayIdx = awayIdx;
			if (base.homeIdx !== null && base.awayIdx !== null) {
				const live = mergeLive(base.homeIdx, base.awayIdx);
				if (live) Object.assign(base, live);
			}
			winnerOf.set(m.id, resolveWinner(base));
			loserOf.set(m.id, resolveLoser(base));
			return base;
		});
	}, [gMatches, clinchedWinners, live.matches]);

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

			{/* Cold-load skeleton: only before any data (cached or fetched) exists.
				 On refresh, localStorage hydrates the hooks so `matches` is populated
				 instantly and this branch never fires. */}
			{live.loading && live.matches.length === 0 ? (
				<Skeleton />
			) : (
				<>
					{effectiveTab === "standings" && (
						<Standings gMatches={gMatches} kMatches={kMatches} winnerProbs={live.winnerProbs} />
					)}
					{effectiveTab === "games" && (
						<GamesView
							gMatches={gMatches}
							kMatches={kMatches}
							odds={live.odds}
						/>
					)}
					{effectiveTab === "bracket" && (
						<BracketView matches={kMatches} />
					)}
					{effectiveTab === "my-teams" && (
						<MyTeams
							gMatches={gMatches}
							kMatches={kMatches}
							advancing={advancing}
						/>
					)}
				</>
			)}
		</div>
	);
}
