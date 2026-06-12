// ── Guide mockups ─────────────────────────────────────────────────────
// Lightweight HTML/CSS recreations of the app's real screens, used by the
// "How it works" page and the first-login walkthrough to show new players
// exactly where to tap. They're pure presentation (no app state, no images),
// so they never go stale and stay crisp on any screen. Labels mirror the real
// UI in LiveApp.tsx; keep them in sync if the real buttons are renamed.

import type { ReactNode } from "react";

// A faux phone screen: a titled app surface the mock content sits inside.
function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="gm-frame" aria-hidden="true">
      <div className="gm-bar">
        <span className="gm-brand">
          The World Cup <em>Draw</em>
        </span>
        <span className="gm-tab">{title}</span>
      </div>
      <div className="gm-screen">{children}</div>
    </div>
  );
}

// Wrap the one thing a new player should tap. Draws an animated pulsing ring
// around it. With a `label`, a "tap here" pointer sits in normal flow *above*
// the control (never overlapping neighbouring content). Without a label, it's
// a ring-only highlight (e.g. a selected chip that speaks for itself).
function Hot({ children, label }: { children: ReactNode; label?: string }) {
  if (!label) return <span className="gm-ring">{children}</span>;
  return (
    <span className="gm-hot">
      <span className="gm-tap">👆 {label}</span>
      <span className="gm-ring">{children}</span>
    </span>
  );
}

// Step 1 — start a draw, then invite friends (by link or code).
export function CreateJoinMock() {
  return (
    <Frame title="My games">
      <div className="gm-field">
        <span className="gm-label">New draw — give it a name</span>
        <span className="gm-input">Family draw</span>
      </div>
      <div className="gm-field">
        <span className="gm-label">Buy-in per player (R)</span>
        <span className="gm-input">100</span>
      </div>
      <Hot label="Tap to create">
        <span className="gm-btn">Start a new draw →</span>
      </Hot>

      {/* The invite: share a link, or read out the 4-letter code. */}
      <div className="gm-invite">
        <span className="gm-cap">Then invite your friends</span>
        <span className="gm-link">wcdraw.app/join/WC7K</span>
        <Hot label="Tap to copy">
          <span className="gm-btn gm-ghost">📋 Copy invite link</span>
        </Hot>
        <span className="gm-codenote">
          …or they enter code <b>WC7K</b> on their own phone
        </span>
      </div>
    </Frame>
  );
}

// Step 2 — everyone pays the same buy-in into one pot.
export function PotMock() {
  const payers = ["Luc", "Sam", "Mia", "Jo"];
  return (
    <Frame title="The pot">
      <div className="gm-payers">
        {payers.map((p) => (
          <div className="gm-payer" key={p}>
            <span className="gm-ava">{p[0]}</span>
            <span className="gm-paid">+R100</span>
          </div>
        ))}
      </div>
      <div className="gm-arrow">↓</div>
      <div className="gm-pot">
        <span className="gm-pot-amt">R400</span>
        <span className="gm-pot-lbl">winner takes the pot</span>
      </div>
    </Frame>
  );
}

// Step 3 — pick your African bonus team.
export function AfricanPickMock() {
  const teams = [
    { flag: "🇲🇦", name: "Morocco", on: true },
    { flag: "🇸🇳", name: "Senegal" },
    { flag: "🇪🇬", name: "Egypt" },
    { flag: "🇨🇮", name: "Côte d’Ivoire" },
  ];
  return (
    <Frame title="Lobby">
      <div className="gm-cap">Tap one African team — it scores double 👇</div>
      <div className="gm-afr-grid">
        {teams.map((t) =>
          t.on ? (
            <Hot key={t.name}>
              <span className="gm-afr on">
                <span className="flag">{t.flag}</span>
                {t.name}
                <span className="gm-check">✓</span>
              </span>
            </Hot>
          ) : (
            <span className="gm-afr" key={t.name}>
              <span className="flag">{t.flag}</span>
              {t.name}
            </span>
          ),
        )}
      </div>
    </Frame>
  );
}

// Step 4 — draw three random teams, one from each pot.
export function DrawMock() {
  return (
    <Frame title="Your squad">
      <div className="gm-pots">
        <div className="gm-slot t1">
          <span className="gm-slot-lbl">Pot 1 · strong</span>
          <span className="gm-slot-team">
            <span className="flag">🇧🇷</span> Brazil
          </span>
        </div>
        <div className="gm-slot t2">
          <span className="gm-slot-lbl">Pot 2 · middle</span>
          <span className="gm-slot-team">
            <span className="flag">🇯🇵</span> Japan
          </span>
        </div>
        <div className="gm-slot t3 empty">
          <span className="gm-slot-lbl">Pot 3 · outsiders</span>
          <span className="gm-slot-team gm-muted">?</span>
        </div>
      </div>
      <Hot label="Tap to draw">
        <span className="gm-btn">🎲 Tap to draw</span>
      </Hot>
    </Frame>
  );
}

// Step 5 — follow the real matches; points land automatically.
export function FollowMock() {
  return (
    <Frame title="Results">
      <div className="gm-result">
        <span className="gm-side">
          <span className="flag">🇧🇷</span> Brazil
        </span>
        <span className="gm-score">2 – 1</span>
        <span className="gm-side r">
          Serbia <span className="flag">🇷🇸</span>
        </span>
        <span className="gm-ft">FT</span>
      </div>
      <div className="gm-points">
        <span className="gm-tick">+3</span> Brazil won — points added to your
        squad automatically
      </div>
    </Frame>
  );
}

// Step 6 — best total takes the pot.
export function LeaderboardMock() {
  const rows = [
    { pos: 1, name: "Mia", pts: 41, win: true },
    { pos: 2, name: "Luc", pts: 38 },
    { pos: 3, name: "Sam", pts: 33 },
  ];
  return (
    <Frame title="Standings">
      <div className="gm-board">
        {rows.map((r) => (
          <div className={`gm-board-row${r.win ? " win" : ""}`} key={r.name}>
            <span className="gm-pos">{r.win ? "🏆" : r.pos}</span>
            <span className="gm-name">{r.name}</span>
            <span className="gm-flags">⚽⚽⚽</span>
            <span className="gm-total">{r.pts}</span>
          </div>
        ))}
      </div>
      <div className="gm-cap center">Highest total when the World Cup ends wins.</div>
    </Frame>
  );
}

// Betting (optional, host-enabled) — bet your bankroll on real match outcomes.
export function BettingMock() {
  return (
    <Frame title="Betting">
      <div className="gm-bank">
        <div className="gm-bankstat">
          <span className="gm-bank-num">30</span>
          <span className="gm-bank-lbl">available</span>
        </div>
        <div className="gm-bankstat">
          <span className="gm-bank-num">0</span>
          <span className="gm-bank-lbl">in play</span>
        </div>
        <div className="gm-bankstat">
          <span className="gm-bank-num">+0</span>
          <span className="gm-bank-lbl">settled P&amp;L</span>
        </div>
      </div>
      <div className="gm-fixture">
        <div className="gm-fix-teams">
          <span className="flag">🇩🇪</span> Germany&nbsp; v &nbsp;Croatia{" "}
          <span className="flag">🇭🇷</span>
        </div>
        <div className="gm-odds">
          <span className="gm-odd on">
            Germany <b>×1.79</b>
          </span>
          <span className="gm-odd">
            Draw <b>×3.40</b>
          </span>
          <span className="gm-odd">
            Croatia <b>×2.26</b>
          </span>
        </div>
        <div className="gm-stake-row">
          <span className="gm-input gm-stake">20</span>
          <Hot label="Place it">
            <span className="gm-btn gm-sm">Place bet</span>
          </Hot>
        </div>
        <div className="gm-fix-foot">
          Returns <b>36</b> if Germany win
        </div>
      </div>
    </Frame>
  );
}
