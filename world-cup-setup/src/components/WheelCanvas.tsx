import { useEffect, useRef, useCallback } from "react";
import { TEAMS, TEAM_COLORS } from "../data/teams";

interface Props {
	allRemaining: number[];
	eligibleTeams: number[];
	spinning: boolean;
	onSpinComplete: (teamIdx: number) => void;
}

export function WheelCanvas({
	allRemaining,
	eligibleTeams,
	spinning,
	onSpinComplete,
}: Props) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const angleRef = useRef(0);
	const animRef = useRef<number>(0);
	const spinCompleteRef = useRef(false);

	const eligibleLookup = new Set(eligibleTeams);
	const segments = allRemaining.map((i) => TEAMS[i]);
	const isEligible = allRemaining.map((i) => eligibleLookup.has(i));

	const draw = useCallback(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		const W = canvas.width;
		const H = canvas.height;
		const cx = W / 2,
			cy = H / 2,
			R = W / 2 - 10;

		ctx.clearRect(0, 0, W, H);
		const n = segments.length;
		if (n === 0) return;

		const arc = (2 * Math.PI) / n;

		ctx.save();
		ctx.translate(cx, cy);
		ctx.rotate(angleRef.current);

		for (let i = 0; i < n; i++) {
			const a1 = i * arc;
			const a2 = a1 + arc;
			const team = segments[i];
			const ok = isEligible[i];
			const color = TEAM_COLORS[team.name] || "#444";

			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.arc(0, 0, R, a1, a2);
			ctx.closePath();

			if (ok) {
				ctx.fillStyle = color;
			} else {
				ctx.fillStyle = "#222";
			}
			ctx.fill();
			if (!ok) {
				ctx.fillStyle = "rgba(0,0,0,0.4)";
				ctx.fill();
			}

			ctx.strokeStyle = "rgba(255,255,255,0.12)";
			ctx.lineWidth = 1.5;
			ctx.stroke();

			// Text
			ctx.save();
			ctx.rotate(a1 + arc / 2);
			ctx.textAlign = "right";
			ctx.fillStyle = ok ? "#fff" : "rgba(255,255,255,0.3)";
			ctx.font = `bold ${n > 30 ? 11 : 13}px Oswald, sans-serif`;
			ctx.shadowColor = "rgba(0,0,0,0.7)";
			ctx.shadowBlur = 4;
			const label = ok
				? team.name.length > 14
					? team.name.substring(0, 13) + "…"
					: team.name
				: "✕ " + team.name.substring(0, 10);
			ctx.fillText(label, R - 18, 5);
			ctx.restore();
		}

		// Outer ring
		ctx.beginPath();
		ctx.arc(0, 0, R, 0, Math.PI * 2);
		ctx.strokeStyle = "rgba(212,160,23,0.4)";
		ctx.lineWidth = 4;
		ctx.stroke();

		ctx.restore();
	}, [segments, isEligible]);

	useEffect(() => {
		draw();
	}, [draw, allRemaining]);

	useEffect(() => {
		if (!spinning || segments.length === 0) return;
		spinCompleteRef.current = false;

		// Always land on an eligible segment
		const eligibleIndices = isEligible
			.map((ok, i) => (ok ? i : -1))
			.filter((i) => i >= 0);
		if (eligibleIndices.length === 0) return;

		const targetSegIdx =
			eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
		const n = segments.length;
		const arc = (2 * Math.PI) / n;

		// Random speed: 3-25 rotations, 3-10 seconds
		const spins = 3 + Math.random() * 22;
		const duration = 3000 + Math.random() * 7000;
		// Random direction: 50/50 clockwise vs counter-clockwise
		const direction = Math.random() < 0.5 ? 1 : -1;
		// Angle where targetSegIdx center aligns with the top pointer (−π/2)
		const targetCenter = targetSegIdx * arc + arc / 2;
		const randomOffset = (Math.random() - 0.5) * arc * 0.6; // jitter within segment
		const landAngle =
			-targetCenter +
			randomOffset -
			Math.PI / 2 +
			direction * spins * Math.PI * 2;
		const startAngle = angleRef.current;
		const totalRotation = landAngle - startAngle;
		const startTime = performance.now();

		function animate(now: number) {
			const elapsed = now - startTime;
			const progress = Math.min(elapsed / duration, 1);
			const eased = 1 - Math.pow(1 - progress, 3);
			angleRef.current = startAngle + totalRotation * eased;
			draw();

			if (progress < 1) {
				animRef.current = requestAnimationFrame(animate);
			} else if (!spinCompleteRef.current) {
				spinCompleteRef.current = true;
				const team = segments[targetSegIdx];
				const originalIdx = TEAMS.indexOf(team);
				onSpinComplete(originalIdx);
			}
		}

		animRef.current = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(animRef.current);
	}, [spinning]); // eslint-disable-line react-hooks/exhaustive-deps

	return (
		<div className="wheel-container">
			<div className="wheel-pointer" />
			<canvas
				ref={canvasRef}
				className="wheel-canvas"
				width={760}
				height={760}
			/>
			<div className="wheel-center">SPIN</div>
		</div>
	);
}
