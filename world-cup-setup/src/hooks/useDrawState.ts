import { useState, useCallback, useEffect } from "react";
import type { DrawState, Screen } from "../types";

const STORAGE_KEY = "wc2026-draw";

function buildSnakeOrder(playerCount: number, rounds: number): number[] {
	const order: number[] = [];
	for (let r = 0; r < rounds; r++) {
		const reversed = r % 2 === 1;
		for (let p = 0; p < playerCount; p++) {
			order.push(reversed ? playerCount - 1 - p : p);
		}
	}
	return order;
}

// JSON-serializable version (Sets → arrays)
interface SerializedState {
	players: string[];
	playerTeams: number[][];
	playerUsedGroups: string[][];
	availableTeams: number[];
	pickOrder: number[];
	currentPick: number;
}

function serialize(s: DrawState): SerializedState {
	return {
		...s,
		playerUsedGroups: s.playerUsedGroups.map((set) => [...set]),
		availableTeams: [...s.availableTeams],
	};
}

function hydrate(s: SerializedState): DrawState {
	return {
		...s,
		playerUsedGroups: s.playerUsedGroups.map((arr) => new Set(arr)),
		availableTeams: new Set(s.availableTeams),
	};
}

function loadSaved(): { screen: Screen; state: DrawState | null } {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { screen: "setup", state: null };
		const parsed = JSON.parse(raw);
		if (!parsed || !parsed.state) return { screen: "setup", state: null };
		return {
			screen: parsed.screen as Screen,
			state: hydrate(parsed.state as SerializedState),
		};
	} catch {
		return { screen: "setup", state: null };
	}
}

function save(screen: Screen, state: DrawState | null) {
	if (!state) {
		localStorage.removeItem(STORAGE_KEY);
		return;
	}
	localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({ screen, state: serialize(state) }),
	);
}

export function useDrawState() {
	const saved = loadSaved();
	const [screen, setScreen] = useState<Screen>(saved.screen);
	const [state, setState] = useState<DrawState | null>(saved.state);

	// Persist on every change
	useEffect(() => {
		save(screen, state);
	}, [screen, state]);

	const initDraw = useCallback((players: string[]) => {
		const n = players.length;
		const pickOrder = buildSnakeOrder(n, 6);
		setState({
			players,
			playerTeams: Array.from({ length: n }, () => []),
			playerUsedGroups: Array.from({ length: n }, () => new Set<string>()),
			availableTeams: new Set(Array.from({ length: 48 }, (_, i) => i)),
			pickOrder,
			currentPick: 0,
		});
		setScreen("draw");
	}, []);

	const assignTeam = useCallback((teamIdx: number, teamGroup: string) => {
		setState((prev) => {
			if (!prev) return prev;
			const playerIdx = prev.pickOrder[prev.currentPick];
			const newAvailable = new Set(prev.availableTeams);
			newAvailable.delete(teamIdx);
			const newPlayerTeams = prev.playerTeams.map((arr, i) =>
				i === playerIdx ? [...arr, teamIdx] : arr,
			);
			const newPlayerUsedGroups = prev.playerUsedGroups.map((s, i) => {
				if (i !== playerIdx) return s;
				const ns = new Set(s);
				ns.add(teamGroup);
				return ns;
			});
			return {
				...prev,
				playerTeams: newPlayerTeams,
				playerUsedGroups: newPlayerUsedGroups,
				availableTeams: newAvailable,
				currentPick: prev.currentPick + 1,
			};
		});
	}, []);

	const reset = useCallback(() => {
		setState(null);
		setScreen("setup");
		localStorage.removeItem(STORAGE_KEY);
	}, []);

	return { screen, setScreen, state, initDraw, assignTeam, reset };
}
