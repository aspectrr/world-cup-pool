import { useCallback } from "react";
import { useDrawState } from "./hooks/useDrawState";
import { SetupScreen } from "./components/SetupScreen";
import { DrawScreen } from "./components/DrawScreen";
import { CompleteScreen } from "./components/CompleteScreen";
import { Confetti } from "./components/Confetti";

export default function App() {
	const { screen, setScreen, state, initDraw, assignTeam, reset } =
		useDrawState();

	const handleDrawComplete = useCallback(() => {
		setScreen("complete");
	}, [setScreen]);

	return (
		<>
			{screen === "complete" && <Confetti />}

			{screen === "setup" && (
				<header className="header">
					<h1>World Cup 2026</h1>
				</header>
			)}

			{screen === "setup" && <SetupScreen onStart={initDraw} />}

			{screen === "draw" && state && (
				<DrawScreen
					state={state}
					onComplete={handleDrawComplete}
					onAssign={assignTeam}
				/>
			)}

			{screen === "complete" && state && (
				<CompleteScreen
					players={state.players}
					playerTeams={state.playerTeams}
					onRedraw={reset}
				/>
			)}
		</>
	);
}
