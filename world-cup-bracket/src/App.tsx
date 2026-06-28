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
import { useESPNLive } from "./hooks/useESPNLive";
import type { ServerMatch } from "./hooks/useESPNLive";
import { Standings } from "./components/Standings";
import { GamesView } from "./components/GamesView";
import { BracketView } from "./components/BracketView";
import { MyTeams } from "./components/MyTeams";
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
	const live = useESPNLive();

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
					detail: sm.detail,
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
	// via populateR32, then live scores/status/clock merged from the server,
	// then winners propagated forward to fill R16→QF→SF→FINAL feeders so
	// downstream rounds also merge live scores.
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

		// Pass 1: fill R32 from group results + live server merge.
		const out = initKnockoutMatches.map((m) => {
			if (m.round !== "R32") return m;
			const slot = R32_SLOTS.find((s) => s.id === m.id);
			if (!slot) return m;
			const filled = r32.get(m.id);
			if (!filled) return m;
			const [homeIdx, awayIdx] = filled;
			const tg = thirdGroupFor.get(m.id) ?? null;
			const homeSeed = seedLabel(slot.home, groupLetterOfIfThird(slot.home, tg));
			const awaySeed = seedLabel(slot.away, groupLetterOfIfThird(slot.away, tg));

			const sm =
				homeIdx !== null && awayIdx !== null
					? byTeams.get(`${homeIdx}v${awayIdx}`)
					: undefined;
			if (!sm || sm.date < R32_START) {
				return { ...m, homeIdx, awayIdx, homeSeed, awaySeed };
			}
			const isReversed = sm.home_idx === awayIdx;
			const homeScore = isReversed ? sm.away_score : sm.home_score;
			const awayScore = isReversed ? sm.home_score : sm.away_score;
			const played = sm.status === "finished" || sm.status === "live";
			return {
				...m,
				homeIdx,
				awayIdx,
				homeSeed,
				awaySeed,
				homeScore,
				awayScore,
				played,
				status: sm.status,
				clock: sm.clock,
				date: sm.date,
				winnerIdx: sm.winner_idx,
				detail: sm.detail,
			};
		});

		// Pass 2: propagate winners forward to fill downstream feeders.
		// R16[i] is fed by out[2i] + out[2i+1]; QF/SF/FINAL chain the same
		// pattern (see generateKnockoutMatches for the offset math).
		const winnerOf = (m: KnockoutMatch): number | null => {
			if (!m.played || m.homeScore === null || m.awayScore === null) return null;
			if (m.winnerIdx !== null && m.winnerIdx !== undefined) return m.winnerIdx;
			if (m.homeScore > m.awayScore) return m.homeIdx;
			if (m.awayScore > m.homeScore) return m.awayIdx;
			return null;
		};

		// R16 feeders: out[0..15] (R32) → out[16..23]
		for (let i = 0; i < 8; i++) {
			const a = out[i * 2];
			const b = out[i * 2 + 1];
			const homeIdx = winnerOf(a);
			const awayIdx = winnerOf(b);
			if (homeIdx === null && awayIdx === null) continue;
			out[16 + i] = { ...out[16 + i], homeIdx, awayIdx };
		}
		// QF feeders: out[16..23] (R16) → out[24..27]
		for (let i = 0; i < 4; i++) {
			const a = out[16 + i * 2];
			const b = out[16 + i * 2 + 1];
			const homeIdx = winnerOf(a);
			const awayIdx = winnerOf(b);
			if (homeIdx === null && awayIdx === null) continue;
			out[24 + i] = { ...out[24 + i], homeIdx, awayIdx };
		}
		// SF feeders: out[24..27] (QF) → out[28..29]
		for (let i = 0; i < 2; i++) {
			const a = out[24 + i * 2];
			const b = out[24 + i * 2 + 1];
			const homeIdx = winnerOf(a);
			const awayIdx = winnerOf(b);
			if (homeIdx === null && awayIdx === null) continue;
			out[28 + i] = { ...out[28 + i], homeIdx, awayIdx };
		}
		// FINAL feeders: out[28..29] (SF) → out[30]
		{
			const homeIdx = winnerOf(out[28]);
			const awayIdx = winnerOf(out[29]);
			if (homeIdx !== null || awayIdx !== null) {
				out[30] = { ...out[30], homeIdx, awayIdx };
			}
		}

		// Pass 3: merge live server data for any knockout match whose team
		// pairing now resolves (R16+). Catches score/status/winnerIdx/detail.
		for (let i = 16; i < out.length; i++) {
			const m = out[i];
			if (m.homeIdx === null || m.awayIdx === null) continue;
			const sm = byTeams.get(`${m.homeIdx}v${m.awayIdx}`);
			if (!sm || sm.date < R32_START) continue;
			const isReversed = sm.home_idx === m.awayIdx;
			const homeScore = isReversed ? sm.away_score : sm.home_score;
			const awayScore = isReversed ? sm.home_score : sm.away_score;
			const played = sm.status === "finished" || sm.status === "live";
			out[i] = {
				...m,
				homeScore,
				awayScore,
				played,
				status: sm.status,
				clock: sm.clock,
				date: sm.date,
				winnerIdx: sm.winner_idx,
				detail: sm.detail,
			};
		}

		return out;
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

			{effectiveTab === "standings" && (
				<Standings gMatches={gMatches} kMatches={kMatches} />
			)}
			{effectiveTab === "games" && (
				<GamesView gMatches={gMatches} kMatches={kMatches} />
			)}
			{effectiveTab === "bracket" && (
				<BracketView
					matches={kMatches}
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
