import { useEffect, useRef, useState } from "react";
import {
  POOL,
  ENTRY_FEE,
  MAX_PLAYERS,
  TIERS,
  REVEAL_MS,
} from "../convex/pool";
import {
  Header,
  RevealOverlay,
  TIER_NAME,
  TIER_VAR,
  shuffle,
  whoseTurn,
} from "./shared";
import Fixtures from "./FixturesView";

type LocalTeam = {
  name: string;
  flag: string;
  tier: number;
  ownerId?: number;
  assignedAt?: number;
};

type LocalState = {
  status: "setup" | "drawing" | "done";
  players: { id: number; name: string }[];
  turnOrder: number[];
  pickIndex: number;
  teams: LocalTeam[];
};

const STORAGE_KEY = "wc_local_game";

function load(): LocalState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LocalState) : null;
  } catch {
    return null;
  }
}

function freshTeams(): LocalTeam[] {
  return POOL.map((t) => ({ name: t.name, flag: t.flag, tier: t.tier }));
}

export default function LocalGame({ onExit }: { onExit: () => void }) {
  const [state, setState] = useState<LocalState>(
    () =>
      load() ?? {
        status: "setup",
        players: [],
        turnOrder: [],
        pickIndex: 0,
        teams: freshTeams(),
      },
  );

  // Persist so a refresh doesn't lose the game.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Ticking clock for reveal windows.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(t);
  }, []);

  if (state.status === "setup") {
    return <Setup onStart={setState} onExit={onExit} />;
  }
  return <Draw state={state} setState={setState} now={now} onExit={onExit} />;
}

// ── Setup: add players ───────────────────────────────────
function Setup({
  onStart,
  onExit,
}: {
  onStart: (s: LocalState) => void;
  onExit: () => void;
}) {
  const [names, setNames] = useState<string[]>(["", ""]);
  const [err, setErr] = useState("");
  const lastRef = useRef<HTMLInputElement>(null);

  function update(i: number, val: string) {
    setNames((ns) => ns.map((n, idx) => (idx === i ? val : n)));
  }
  function add() {
    if (names.length >= MAX_PLAYERS) return;
    setNames((ns) => [...ns, ""]);
    setTimeout(() => lastRef.current?.focus(), 0);
  }
  function remove(i: number) {
    setNames((ns) => ns.filter((_, idx) => idx !== i));
  }

  function start() {
    const clean = names.map((n) => n.trim()).filter(Boolean);
    if (clean.length < 2) return setErr("Add at least 2 players.");
    if (new Set(clean.map((n) => n.toLowerCase())).size !== clean.length)
      return setErr("Give everyone a different name.");

    const players = clean.map((name, id) => ({ id, name }));
    onStart({
      status: "drawing",
      players,
      turnOrder: shuffle(players.map((p) => p.id)),
      pickIndex: 0,
      teams: freshTeams(),
    });
  }

  const pool = ENTRY_FEE * names.filter((n) => n.trim()).length;

  return (
    <>
      <Header pool={pool} count={names.filter((n) => n.trim()).length} />
      <div className="center-stage">
        <div className="panel">
          <h3>Add the players</h3>
          <p className="hint">
            One device, pass it around. R{ENTRY_FEE} each · {TIERS} teams each ·
            up to {MAX_PLAYERS} players.
          </p>
          <div className="roster">
            {names.map((n, i) => (
              <div className="field" key={i} style={{ marginBottom: 0 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    ref={i === names.length - 1 ? lastRef : undefined}
                    value={n}
                    onChange={(e) => update(i, e.target.value)}
                    placeholder={`Player ${i + 1}`}
                    maxLength={18}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") add();
                    }}
                  />
                  {names.length > 2 && (
                    <button
                      className="btn ghost"
                      style={{ width: "auto", padding: "10px 14px" }}
                      onClick={() => remove(i)}
                      aria-label="Remove player"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {names.length < MAX_PLAYERS && (
            <button
              className="btn ghost"
              onClick={add}
              style={{ marginBottom: 14 }}
            >
              + Add another player
            </button>
          )}

          <button className="btn big" onClick={start}>
            Start the draw →
          </button>
          <div className="err">{err}</div>
        </div>
      </div>
      <button className="leave" onClick={onExit}>
        ← Back to menu
      </button>
    </>
  );
}

// ── Draw: pass-the-device turns ──────────────────────────
function Draw({
  state,
  setState,
  now,
  onExit,
}: {
  state: LocalState;
  setState: React.Dispatch<React.SetStateAction<LocalState>>;
  now: number;
  onExit: () => void;
}) {
  const { players, teams, turnOrder, pickIndex } = state;
  const pool = ENTRY_FEE * players.length;
  const done = state.status === "done";

  const revealing = teams.find(
    (t) => t.assignedAt && now < t.assignedAt + REVEAL_MS,
  );
  const revealingOwner = revealing
    ? players.find((p) => p.id === revealing.ownerId)
    : undefined;

  const { idx, tier } = whoseTurn(turnOrder.length, pickIndex);
  const currentPlayer = players.find((p) => p.id === turnOrder[idx]);

  function handleDraw() {
    if (revealing) return;
    setState((s) => {
      const w = whoseTurn(s.turnOrder.length, s.pickIndex);
      const playerId = s.turnOrder[w.idx];
      const available = s.teams.filter((t) => t.tier === w.tier && t.ownerId === undefined);
      if (available.length === 0) return s;
      const pick = available[Math.floor(Math.random() * available.length)];
      const stamp = Date.now();
      const teams = s.teams.map((t) =>
        t === pick ? { ...t, ownerId: playerId, assignedAt: stamp } : t,
      );
      const nextIndex = s.pickIndex + 1;
      const total = s.turnOrder.length * TIERS;
      return {
        ...s,
        teams,
        pickIndex: nextIndex,
        status: nextIndex >= total ? "done" : "drawing",
      };
    });
  }

  function newDraw() {
    setState((s) => ({
      status: "drawing",
      players: s.players,
      turnOrder: shuffle(s.players.map((p) => p.id)),
      pickIndex: 0,
      teams: freshTeams(),
    }));
  }

  function reconfigure() {
    if (!confirm("Start over and re-add players?")) return;
    localStorage.removeItem(STORAGE_KEY);
    setState({
      status: "setup",
      players: [],
      turnOrder: [],
      pickIndex: 0,
      teams: freshTeams(),
    });
  }

  return (
    <>
      {revealing && (
        <RevealOverlay
          ownerName={revealingOwner?.name ?? "Someone"}
          tier={revealing.tier}
        />
      )}

      <Header pool={pool} count={players.length} />

      {!done && (
        <div className="wrap">
          <div className="turnbar">
            <div>
              <div className="turn-label">Pass the device to</div>
              <div className="turn-name">{currentPlayer?.name ?? "—"}</div>
            </div>
            <span className="turn-tier" style={{ background: TIER_VAR[tier] }}>
              {TIER_NAME[tier]}
            </span>
            <div className="spacer" />
            <button
              className="btn"
              disabled={!!revealing}
              onClick={handleDraw}
            >
              {revealing ? "Revealing…" : "🎲 Tap to draw"}
            </button>
          </div>
        </div>
      )}

      {done && (
        <section className="wrap">
          <div className="banner">
            <h3>The draw is locked ✓</h3>
            <p>
              {players.length} squads set · pool of <b>R{pool}</b> · good luck!
              🍀
            </p>
          </div>
        </section>
      )}

      <section className="section wrap">
        <div className="shead">
          <h2>The Squads</h2>
          <span>three teams each · one per tier</span>
          <div className="rule" />
        </div>
        <div className="players">
          {players.map((p) => (
            <PlayerCard
              key={p.id}
              name={p.name}
              isTurn={!done && currentPlayer?.id === p.id}
              teams={teams.filter((t) => t.ownerId === p.id)}
              now={now}
            />
          ))}
        </div>
      </section>

      <section className="section wrap">
        <div className="shead">
          <h2>The Pots</h2>
          <span>what’s left in each tier</span>
          <div className="rule" />
        </div>
        <div className="tiers">
          {[1, 2, 3].map((t) => {
            const tierTeams = teams
              .filter((x) => x.tier === t)
              .sort((a, b) => a.name.localeCompare(b.name));
            const left = tierTeams.filter((x) => x.ownerId === undefined).length;
            return (
              <div className="tier" key={t}>
                <div className="tier-top">
                  <div className="tier-name">
                    <span className={`pip t${t}`} />
                    {TIER_NAME[t]}
                  </div>
                  <div className="tier-num">{left} left</div>
                </div>
                <div className="teamlist">
                  {tierTeams.map((x, i) => {
                    const owner =
                      x.ownerId !== undefined
                        ? players.find((p) => p.id === x.ownerId)
                        : undefined;
                    const revealed =
                      !x.assignedAt || now >= x.assignedAt + REVEAL_MS;
                    const taken = x.ownerId !== undefined && revealed;
                    return (
                      <div className={`team${taken ? " taken" : ""}`} key={i}>
                        <span className="flag">{x.flag}</span>
                        {x.name}
                        {taken && owner && (
                          <span className="owner">{owner.name}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <Fixtures />

      <div className="wrap" style={{ textAlign: "center" }}>
        {done ? (
          <button className="btn" style={{ width: "auto" }} onClick={newDraw}>
            Run it again (same players) →
          </button>
        ) : null}
        <button
          className="leave"
          onClick={reconfigure}
          style={{ textDecoration: "underline", marginTop: 18 }}
        >
          Start over / edit players
        </button>
      </div>
      <button className="leave" onClick={onExit}>
        ← Back to menu
      </button>
    </>
  );
}

function PlayerCard({
  name,
  isTurn,
  teams,
  now,
}: {
  name: string;
  isTurn: boolean;
  teams: LocalTeam[];
  now: number;
}) {
  const mine = [...teams].sort((a, b) => a.tier - b.tier);
  const shown = mine.filter(
    (t) => !t.assignedAt || now >= t.assignedAt + REVEAL_MS,
  ).length;
  return (
    <div className={`player${isTurn ? " is-turn" : ""}`}>
      <div className="pname">{name}</div>
      <div className="pstake">
        R{ENTRY_FEE} in · {shown}/{TIERS} teams
      </div>
      <div className="draw">
        {[1, 2, 3].map((tier) => {
          const team = mine.find((t) => t.tier === tier);
          if (!team) {
            return (
              <div className="drawteam empty" key={tier}>
                {TIER_NAME[tier]} · to be drawn
              </div>
            );
          }
          const revealed =
            !team.assignedAt || now >= team.assignedAt + REVEAL_MS;
          if (!revealed) {
            return (
              <div className="drawteam revealing" key={tier}>
                <span className="spin-flag">🎲</span> drawing…
                <span className="tag" style={{ background: TIER_VAR[tier] }}>
                  T{tier}
                </span>
              </div>
            );
          }
          const fresh =
            team.assignedAt && now < team.assignedAt + REVEAL_MS + 600;
          return (
            <div className={`drawteam${fresh ? " pop" : ""}`} key={tier}>
              <span className="flag">{team.flag}</span>
              {team.name}
              <span className="tag" style={{ background: TIER_VAR[tier] }}>
                T{tier}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
