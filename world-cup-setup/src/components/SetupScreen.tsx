import { useState } from "react";

interface Props {
  onStart: (players: string[]) => void;
}

export function SetupScreen({ onStart }: Props) {
  const [names, setNames] = useState<string[]>(
    Array.from({ length: 8 }, () => ""),
  );

  const update = (i: number, val: string) => {
    const next = [...names];
    next[i] = val;
    setNames(next);
  };

  const handleSubmit = () => {
    const players = names.map((n, i) => n.trim() || `Player ${i + 1}`);
    onStart(players);
  };

  return (
    <section className="setup-screen">
      <div className="setup-card">
        <h2>Enter Players</h2>
        <div className="player-inputs">
          {names.map((n, i) => (
            <input
              key={i}
              type="text"
              placeholder={`Player ${i + 1}`}
              value={n}
              onChange={(e) => update(i, e.target.value)}
            />
          ))}
        </div>
        <button className="btn-start" onClick={handleSubmit}>
          Start the Draw
        </button>
      </div>
    </section>
  );
}
