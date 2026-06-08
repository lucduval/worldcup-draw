// Presentational bits + pure helpers shared by Live and Local modes.
import { useEffect, useState } from "react";
import { ENTRY_FEE } from "../convex/pool";

export const TIER_VAR = ["", "var(--tier1)", "var(--tier2)", "var(--tier3)"];
export const TIER_NAME = ["", "Tier 1", "Tier 2", "Tier 3"];
export const REEL = ["🇧🇷", "🇫🇷", "🇦🇷", "🇪🇸", "🇩🇪", "🇯🇵", "🇲🇦", "🇳🇬", "🇺🇸", "🇵🇹"];

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A round profile picture, falling back to the player's initial when they
// haven't set one. Used across rosters, squad cards, standings and the header.
export function Avatar({
  src,
  name,
  size = 28,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {src ? <img src={src} alt="" /> : <span>{initial}</span>}
    </span>
  );
}

export function Header({
  pool,
  count,
  teamsEach,
}: {
  pool: number;
  count: number;
  teamsEach: number;
}) {
  return (
    <header className="wrap">
      <h1>
        The World Cup <em>Draw</em>
      </h1>
      <div className="potbar">
        <div className="chip">
          <span className="dot" />
          {count} player{count === 1 ? "" : "s"}
        </div>
        <div className="chip">
          <span className="dot" />R{ENTRY_FEE} buy-in
        </div>
        <div className="chip">
          <span className="dot" />
          {teamsEach} teams each
        </div>
        <div className="chip pool">
          <span className="dot" />
          <b>R{pool}</b> pool
        </div>
      </div>
    </header>
  );
}

export function RevealOverlay({
  ownerName,
  tier,
}: {
  ownerName: string;
  tier: number;
}) {
  const [face, setFace] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFace((f) => (f + 1) % REEL.length), 90);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="overlay">
      <div className="drum">🥁 the draw 🥁</div>
      <div className="who">
        <em>{ownerName}</em> is drawing…
      </div>
      <div className="reel">{REEL[face]}</div>
      <span className="tier-pill" style={{ background: TIER_VAR[tier] }}>
        {TIER_NAME[tier]}
      </span>
    </div>
  );
}
