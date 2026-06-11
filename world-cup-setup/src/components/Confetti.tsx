import { useEffect, useRef } from "react";

export function Confetti() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;

		const colors = [
			"#d4a017",
			"#f0d060",
			"#1a8a3a",
			"#c41e3a",
			"#ffffff",
			"#74ACDF",
			"#FF6600",
		];
		const particles = Array.from({ length: 200 }, () => ({
			x: Math.random() * canvas.width,
			y: Math.random() * canvas.height - canvas.height,
			w: 4 + Math.random() * 8,
			h: 4 + Math.random() * 4,
			color: colors[Math.floor(Math.random() * colors.length)],
			vx: (Math.random() - 0.5) * 4,
			vy: 2 + Math.random() * 4,
			rotation: Math.random() * Math.PI * 2,
			rotSpeed: (Math.random() - 0.5) * 0.2,
		}));

		let frames = 0;
		function animate() {
			if (!ctx || !canvas) return;
			ctx.clearRect(0, 0, canvas.width, canvas.height);
			let alive = false;
			for (const p of particles) {
				p.x += p.vx;
				p.y += p.vy;
				p.vy += 0.05;
				p.rotation += p.rotSpeed;
				if (p.y < canvas.height + 20) alive = true;
				ctx.save();
				ctx.translate(p.x, p.y);
				ctx.rotate(p.rotation);
				ctx.fillStyle = p.color;
				ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
				ctx.restore();
			}
			frames++;
			if (alive && frames < 300) {
				requestAnimationFrame(animate);
			} else {
				ctx.clearRect(0, 0, canvas.width, canvas.height);
			}
		}
		animate();

		const onResize = () => {
			canvas.width = window.innerWidth;
			canvas.height = window.innerHeight;
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	return <canvas id="confetti-canvas" ref={canvasRef} />;
}
