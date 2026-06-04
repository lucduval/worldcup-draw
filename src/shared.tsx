// Presentational bits + pure helpers shared by Live and Local modes.
import { useEffect, useState } from "react";
import { ENTRY_FEE, TIERS } from "../convex/pool";

export const TIER_VAR = ["", "var(--tier1)", "var(--tier2)", "var(--tier3)"];
export const TIER_NAME = ["", "Tier 1", "Tier 2", "Tier 3"];
export const REEL = ["🇧🇷", "🇫🇷", "🇦🇷", "🇪🇸", "🇩🇪", "🇯🇵", "🇲🇦", "🇳🇬", "🇺🇸", "🇵🇹"];

// Snake order: round 0 forward, round 1 reverse, round 2 forward.
// Each round draws from one tier (round + 1).
export function whoseTurn(n: number, pickIndex: number) {
  const round = Math.floor(pickIndex / n);
  const pos = pickIndex % n;
  const idx = round % 2 === 0 ? pos : n - 1 - pos;
  return { idx, tier: round + 1, round };
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function Header({ pool, count }: { pool: number; count: number }) {
  return (
    <header className="wrap">
      <div className="kicker">Friends’ Sweepstake · 2026</div>
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
          {TIERS} teams each
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
