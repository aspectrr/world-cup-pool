import { useState, useCallback, useMemo } from "react";
import type { DrawState } from "../types";
import { TEAMS } from "../data/teams";
import { WheelCanvas } from "./WheelCanvas";
import { PlayerCard } from "./PlayerCard";
import { ResultReveal } from "./ResultReveal";

interface Props {
	state: DrawState;
	onComplete: () => void;
	onAssign: (teamIdx: number, group: string) => void;
}

export function DrawScreen({ state, onComplete, onAssign }: Props) {
	const [spinning, setSpinning] = useState(false);
	const [revealedTeam, setRevealedTeam] = useState<number | null>(null);
	const [autoAssigned, setAutoAssigned] = useState<{
		player: string;
		team: number;
	} | null>(null);

	const isDone = state.currentPick >= 48;
	const currentPlayerIdx = state.pickOrder[state.currentPick] ?? 0;
	const currentPlayer = state.players[currentPlayerIdx];
	const currentRound = Math.floor(state.currentPick / 8) + 1;
	const pickInRound = (state.currentPick % 8) + 1;

	const allRemaining = useMemo(
		() => Array.from(state.availableTeams),
		[state.availableTeams],
	);

	const eligibleTeams = useMemo(() => {
		const usedGroups = state.playerUsedGroups[currentPlayerIdx];
		return Array.from(state.availableTeams).filter(
			(i) => !usedGroups.has(TEAMS[i].group),
		);
	}, [state.availableTeams, state.playerUsedGroups, currentPlayerIdx]);

	const handleSpin = useCallback(() => {
		if (spinning || eligibleTeams.length === 0) return;

		// If only 1 eligible team left, no spin needed — auto-assign
		if (eligibleTeams.length === 1) {
			const teamIdx = eligibleTeams[0];
			setRevealedTeam(teamIdx);
			onAssign(teamIdx, TEAMS[teamIdx].group);
			return;
		}

		setSpinning(true);
		setRevealedTeam(null);
	}, [spinning, eligibleTeams, onAssign]);

	const handleSpinComplete = useCallback(
		(teamIdx: number) => {
			setSpinning(false);
			setRevealedTeam(teamIdx);
			onAssign(teamIdx, TEAMS[teamIdx].group);
		},
		[onAssign],
	);

	const handleNext = useCallback(() => {
		setRevealedTeam(null);
		setAutoAssigned(null);

		// After revealing, check if next pick is the last one (1 team left)
		// and auto-assign it
		const nextPick = state.currentPick; // already incremented by onAssign
		if (nextPick < 48) {
			const nextPlayerIdx = state.pickOrder[nextPick];
			const nextUsedGroups = state.playerUsedGroups[nextPlayerIdx];
			const nextRemaining = Array.from(state.availableTeams);
			// Only 1 team left — auto-assign
			if (nextRemaining.length <= 1) {
				const lastTeam = nextRemaining[0];
				const lastPlayer = state.players[nextPlayerIdx];
				setAutoAssigned({ player: lastPlayer, team: lastTeam });
				onAssign(lastTeam, TEAMS[lastTeam].group);
				return;
			}
			// Check if next player has only 1 eligible team
			const nextEligible = nextRemaining.filter(
				(i) => !nextUsedGroups.has(TEAMS[i].group),
			);
			if (nextEligible.length === 1) {
				const teamIdx = nextEligible[0];
				const lastPlayer = state.players[nextPlayerIdx];
				setAutoAssigned({ player: lastPlayer, team: teamIdx });
				onAssign(teamIdx, TEAMS[teamIdx].group);
				return;
			}
		}

		if (nextPick >= 48) {
			onComplete();
		}
	}, [state, onAssign, onComplete]);

	// Deadlock: current player has 0 eligible teams but picks remain
	const deadlocked =
		!isDone && allRemaining.length > 0 && eligibleTeams.length === 0;

	const showWheel = !isDone && allRemaining.length > 1;

	return (
		<section className="draw-screen active">
			{/* Top-right status bar */}
			<div className="status-bar">
				<div className="status-player">
					<span className="status-label">Drawing:</span>
					<span className="status-name">{currentPlayer}</span>
				</div>
				<div className="status-info">
					Rd {currentRound} · Pick {pickInRound} · Team{" "}
					{state.playerTeams[currentPlayerIdx].length + 1}/6
				</div>
				<div className="status-snake">
					{currentRound % 2 === 0 ? "◀ Snake" : "Snake ▶"}
				</div>
				{!isDone && eligibleTeams.length < allRemaining.length && (
					<div className="status-eligible">
						{eligibleTeams.length} of {allRemaining.length} eligible
					</div>
				)}
			</div>

			<div className="draw-layout">
				{/* LEFT: 2×4 player grid */}
				<div className="players-grid">
					{state.players.map((p, i) => (
						<PlayerCard
							key={i}
							playerName={p}
							teamIndices={state.playerTeams[i]}
							isDrawing={i === currentPlayerIdx && !isDone}
						/>
					))}
				</div>

				{/* RIGHT: Wheel + reveal */}
				<div className="wheel-area">
					{deadlocked && (
						<div className="deadlock-msg">
							<div className="deadlock-icon">⚠️</div>
							<div className="deadlock-title">No eligible teams!</div>
							<div className="deadlock-desc">
								All remaining teams are from groups {currentPlayer} already has.
								Reset to start over.
							</div>
						</div>
					)}

					{showWheel && !deadlocked && (
						<>
							<WheelCanvas
								allRemaining={allRemaining}
								eligibleTeams={eligibleTeams}
								spinning={spinning}
								onSpinComplete={handleSpinComplete}
							/>
							<button
								className="btn-spin"
								disabled={spinning || isDone}
								onClick={handleSpin}
							>
								🎰 Spin!
							</button>
						</>
					)}

					{revealedTeam !== null && autoAssigned === null && (
						<ResultReveal teamIdx={revealedTeam} onNext={handleNext} />
					)}

					{autoAssigned !== null && (
						<div className="auto-assign-reveal">
							<div className="auto-assign-badge">Auto-assigned</div>
							<img
								src={`https://flagcdn.com/w160/${TEAMS[autoAssigned.team].code}.png`}
								alt={TEAMS[autoAssigned.team].code}
								className="auto-flag"
							/>
							<div className="auto-team-name">
								{TEAMS[autoAssigned.team].name}
							</div>
							<div className="auto-player-name">→ {autoAssigned.player}</div>
							<button
								className="btn-spin"
								onClick={() => {
									setAutoAssigned(null);
									if (state.currentPick >= 48) onComplete();
								}}
							>
								Continue
							</button>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
