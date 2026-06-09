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

// Copies a shareable invite link (/join/CODE) to the clipboard. Friends who
// open it are auto-joined into the game — the link survives the login gate.
export function CopyInvite({
  code,
  className = "btn ghost",
  label = "Copy invite link",
}: {
  code: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(e: React.MouseEvent) {
    // Game cards are themselves clickable — don't open the room when copying.
    e.stopPropagation();
    const url = `${window.location.origin}/join/${code}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for browsers/contexts without the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
      } catch {
        /* give up silently — the button just won't confirm */
      }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? "Link copied ✓" : label}
    </button>
  );
}

export function Header({
  pool,
  entryFee,
  count,
  teamsEach,
}: {
  pool: number;
  entryFee?: number;
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
          <span className="dot" />R{entryFee ?? ENTRY_FEE} buy-in
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

// How long the reel spins before it lands on the drawn flag. The rest of
// REVEAL_MS is spent holding on the result so everyone sees who got what.
const SPIN_MS = 1300;

export function RevealOverlay({
  ownerName,
  tier,
  flag,
  teamName,
}: {
  ownerName: string;
  tier: number;
  flag: string;
  teamName: string;
}) {
  const [face, setFace] = useState(0);
  const [landed, setLanded] = useState(false);

  // Remount per draw (the overlay only renders while a reveal is live), so the
  // spin restarts and re-lands for each team. Key on the team as a safety net.
  useEffect(() => {
    setLanded(false);
    setFace(0);
    const spin = setInterval(() => setFace((f) => (f + 1) % REEL.length), 90);
    const stop = setTimeout(() => {
      clearInterval(spin);
      setLanded(true);
    }, SPIN_MS);
    return () => {
      clearInterval(spin);
      clearTimeout(stop);
    };
  }, [flag, teamName]);

  return (
    <div className="overlay">
      <div className="drum">🥁 the draw 🥁</div>
      <div className="who">
        <em>{ownerName}</em> {landed ? "drew" : "is drawing…"}
      </div>
      <div className={`reel${landed ? " landed" : ""}`}>
        {landed ? flag : REEL[face]}
      </div>
      {landed && <div className="reel-team">{teamName}</div>}
      <span className="tier-pill" style={{ background: TIER_VAR[tier] }}>
        {TIER_NAME[tier]}
      </span>
    </div>
  );
}
