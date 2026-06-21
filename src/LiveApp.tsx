import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import {
  REVEAL_MS,
  ASYNC_OTHERS_MS,
  ASYNC_MINE_MS,
  ENTRY_FEE,
  MAX_PLAYERS,
  AFRICAN_POOL,
  POOL,
  RANK_BY_NAME,
  TIERS,
  TIMER_PRESETS,
  DEFAULT_TIMER_SECONDS,
  STARTING_POT_DEFAULT,
  STARTING_POT_MAX,
  type BetPick,
} from "../convex/pool";
import {
  Avatar,
  CollapsibleSection,
  CopyInvite,
  Header,
  RevealOverlay,
  TIER_VAR,
  TIER_NAME,
} from "./shared";

// Each player tracks four teams: one African pick plus one per tier.
const TEAMS_EACH = 4;
import Fixtures from "./FixturesView";

// Human label for a timer length, e.g. 30 → "30s", 60 → "1 min", 120 → "2 min".
function fmtTimer(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = seconds / 60;
  return `${m} min`;
}

// The live "what does this pot do?" label, derived from the bands in the PRD:
// the pot is a starting stack each player is handed, so it reads as how much
// betting can swing the room relative to the draw.
function potImpact(pot: number): string {
  if (pot <= 0) return "Betting off for this room.";
  if (pot <= 15)
    return "Nudge — the draw decides the room; betting just shuffles close places.";
  if (pot <= 39)
    return "Co-equal — a hot or cold betting run can overturn the draw.";
  return "Dominant — betting outweighs the draw.";
}

// Host control for the per-player betting bankroll (0 = betting off). A slider +
// number input over [0, STARTING_POT_MAX], with the live impact label beneath.
// In the create form `onChange` just updates local state; in the lobby / a not-
// yet-kicked-off done room it calls setPot.
function PotControl({
  value,
  busy,
  onChange,
  note,
}: {
  value: number;
  busy: boolean;
  onChange: (pot: number) => void;
  note?: string;
}) {
  // Drive the inputs from a local draft so dragging the slider is instant. We
  // only call `onChange` (which may fire a setPot network mutation) when the
  // interaction ends - on pointer release, blur, or Enter. Previously onChange
  // fired on every tick, sending a Convex mutation per pixel of drag, which made
  // the slider crawl.
  const [draft, setDraft] = useState(value);
  // Resync when the committed value changes from outside (a saved setPot, or
  // another host). The parent `value` is stable during a drag (we don't commit
  // until release), so this never fights the user mid-interaction.
  useEffect(() => setDraft(value), [value]);

  const commit = (v: number) => {
    const next = Math.min(STARTING_POT_MAX, Math.max(0, Math.round(v || 0)));
    setDraft(next);
    if (next !== value) onChange(next);
  };

  return (
    <div className="pot-control">
      <div className="pot-row">
        <span className="pot-value">
          {draft === 0 ? "Off" : `${draft} pts`}
        </span>
        <input
          type="number"
          className="pot-num"
          min={0}
          max={STARTING_POT_MAX}
          step={1}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(Number(e.target.value))}
          onBlur={(e) => commit(Number(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(Number(e.currentTarget.value));
          }}
        />
      </div>
      <input
        type="range"
        className="pot-slider"
        min={0}
        max={STARTING_POT_MAX}
        step={1}
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={(e) => commit(Number(e.currentTarget.value))}
        onKeyUp={(e) => commit(Number(e.currentTarget.value))}
        aria-label="Starting betting pot"
      />
      <p className="hint pot-impact">💰 {potImpact(draft)}</p>
      {note && <p className="hint">{note}</p>}
    </div>
  );
}

// Host-only control to toggle the live turn timer and pick its length. Used in
// the lobby and (compact) mid-draw. Only renders for the host; everyone else
// reads the countdown itself off the turn bar.
function TimerControl({
  enabled,
  seconds,
  busy,
  compact,
  onChange,
}: {
  enabled: boolean;
  seconds: number;
  busy: boolean;
  compact?: boolean;
  onChange: (enabled: boolean, seconds: number) => void;
}) {
  return (
    <div className={`timer-control${compact ? " compact" : ""}`}>
      <div className="timer-toggle-row">
        <span className="timer-ctl-label">⏱️ Turn timer</span>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={`timer-switch${enabled ? " on" : ""}`}
          disabled={busy}
          onClick={() => onChange(!enabled, seconds)}
        >
          <span className="knob" />
          <span className="timer-switch-text">{enabled ? "On" : "Off"}</span>
        </button>
      </div>
      {enabled && (
        <div className="timer-presets">
          {TIMER_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              className={`timer-preset${s === seconds ? " selected" : ""}`}
              disabled={busy}
              onClick={() => onChange(true, s)}
            >
              {fmtTimer(s)}
            </button>
          ))}
        </div>
      )}
      {!compact && (
        <p className="hint timer-hint">
          {enabled
            ? `Each player has ${fmtTimer(
                seconds,
              )} to draw. Run out of time and a team is drawn for you automatically.`
            : "Off: players take as long as they like on their turn."}
        </p>
      )}
    </div>
  );
}

// The shared per-turn countdown everyone sees while the timer is running.
// `remainingMs` / `totalMs` drive a thin draining bar; goes urgent in the last
// stretch. `mine` highlights it when it's the viewer's own clock.
function TurnCountdown({
  remainingMs,
  totalMs,
  mine,
}: {
  remainingMs: number;
  totalMs: number;
  mine: boolean;
}) {
  const secs = Math.ceil(remainingMs / 1000);
  const urgent = remainingMs <= 10_000;
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  return (
    <div
      className={`turn-countdown${urgent ? " urgent" : ""}${mine ? " mine" : ""}`}
      role="timer"
      aria-label={`${secs} seconds left`}
    >
      <div className="tc-time">{secs}s</div>
      <div className="tc-bar">
        <span className="tc-fill" style={{ width: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

// Dustbin glyph for destructive actions (host: delete game).
function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

// ── Live mode (auth + Convex provider live in App.tsx) ───
// Routes between the games list and an individual room.
export default function LiveApp({ onExit }: { onExit: () => void }) {
  // The open room lives in the URL (/games/:code), so "My games" (/games)
  // always lands on the list rather than dropping back into a room.
  const navigate = useNavigate();
  const location = useLocation();
  const { code: rawCode } = useParams();
  const code = rawCode ? rawCode.toUpperCase() : null;

  // A failed invite (full/started/unknown game) redirects here with a message.
  const notice = (location.state as { notice?: string } | null)?.notice;

  const data = useQuery(
    api.rooms.getRoom,
    code ? { code } : { code: undefined },
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(t);
  }, []);

  // Stale room code (deleted/unknown): fall back to the list.
  useEffect(() => {
    if (code && data === null) navigate("/games", { replace: true });
  }, [code, data, navigate]);

  function enterRoom(c: string) {
    navigate(`/games/${c.toUpperCase()}`);
  }
  function backToList() {
    navigate("/games");
  }

  if (!code)
    return <GamesList onEnter={enterRoom} onExit={onExit} notice={notice} />;
  if (data === undefined) return <div className="center-stage" />;
  if (data === null) {
    return (
      <GamesList
        onEnter={enterRoom}
        onExit={onExit}
        notice="That game no longer exists - start a fresh one."
      />
    );
  }

  return (
    <Room
      data={data}
      now={now}
      onBack={backToList}
      onExit={onExit}
    />
  );
}

// ── My games: list + create + join ───────────────────────
function GamesList({
  onEnter,
  onExit,
  notice,
}: {
  onEnter: (code: string) => void;
  onExit: () => void;
  notice?: string;
}) {
  const games = useQuery(api.rooms.myGames);
  const createRoom = useMutation(api.rooms.createRoom);
  const joinRoom = useMutation(api.rooms.joinRoom);
  const deleteRoom = useMutation(api.rooms.deleteRoom);
  const [gameName, setGameName] = useState("");
  const [buyIn, setBuyIn] = useState(String(ENTRY_FEE));
  const [mode, setMode] = useState<"live" | "async">("live");
  const [startingPot, setStartingPot] = useState(STARTING_POT_DEFAULT);
  const [joinCode, setJoinCode] = useState("");
  const [err, setErr] = useState(notice || "");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!gameName.trim()) return setErr("Give your draw a name.");
    const fee = Math.round(Number(buyIn));
    if (!Number.isFinite(fee) || fee < 0)
      return setErr("Enter a valid buy-in amount.");
    setBusy(true);
    setErr("");
    try {
      const { code } = await createRoom({
        name: gameName.trim(),
        entryFee: fee,
        mode,
        startingPot,
      });
      onEnter(code);
    } catch (e: any) {
      setErr(e.message ?? "Could not create the game.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(code: string, name: string) {
    if (!confirm(`Delete “${name}” for everyone? This can’t be undone.`)) return;
    setErr("");
    try {
      await deleteRoom({ code });
    } catch (e: any) {
      setErr(e.message ?? "Could not delete the game.");
    }
  }

  async function handleJoin() {
    if (joinCode.trim().length < 4) return setErr("Enter the 4-letter code.");
    setBusy(true);
    setErr("");
    try {
      const { code } = await joinRoom({ code: joinCode.toUpperCase().trim() });
      onEnter(code);
    } catch (e: any) {
      setErr(e.message ?? "Could not join the game.");
    } finally {
      setBusy(false);
    }
  }

  const STATUS_LABEL: Record<string, string> = {
    lobby: "In lobby",
    drawing: "Drawing",
    done: "Complete",
  };

  return (
    <>
      <header className="wrap">
        <div className="kicker">Your draws · 2026</div>
        <h1>
          My <em>games</em>
        </h1>
        <p className="sub">
          Every draw you’re in, in one place - friends, family, work, whatever.
          Jump into any of them, or start a new one.
        </p>
      </header>

      <div className="center-stage">
        <div className="panel">
          <h3>Your games</h3>
          {games === undefined ? (
            <p className="hint">Loading…</p>
          ) : games.length === 0 ? (
            <p className="games-empty">
              No games yet - create one below or join with a code.
            </p>
          ) : (
            <div className="games">
              {games.map((g) => (
                <div className="gamecard" key={g.code}>
                  <button className="gc-open" onClick={() => onEnter(g.code)}>
                    <div className="gc-main">
                      <span className="gc-name">{g.name}</span>
                      <span className="gc-meta">
                        <span className="gc-code">{g.code}</span>·{" "}
                        {g.playerCount} player{g.playerCount === 1 ? "" : "s"}
                        {g.isHost ? " · host" : ""}
                        {g.mode === "async" ? " · watch anytime" : ""}
                      </span>
                    </div>
                    {g.needsAction && (
                      <span className="action-pill">Action needed</span>
                    )}
                    <span className={`status-pill ${g.status}`}>
                      {STATUS_LABEL[g.status]}
                    </span>
                  </button>
                  <CopyInvite
                    code={g.code}
                    className="gc-copy"
                    label="Invite"
                  />
                  {g.isHost && (
                    <button
                      className="gc-delete"
                      onClick={() => handleDelete(g.code, g.name)}
                      aria-label={`Delete ${g.name}`}
                      title="Delete game"
                    >
                      <TrashIcon />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="field">
            <label>New draw - give it a name</label>
            <input
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="e.g. Family draw"
              maxLength={30}
            />
          </div>
          <div className="field">
            <label>Buy-in per player (R)</label>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={10}
              value={buyIn}
              onChange={(e) => setBuyIn(e.target.value)}
              placeholder={String(ENTRY_FEE)}
            />
          </div>
          <div className="field">
            <label>Draw style</label>
            <div className="mode-toggle">
              <button
                type="button"
                className={`mode-opt${mode === "live" ? " selected" : ""}`}
                onClick={() => setMode("live")}
              >
                <span className="mode-title">🔴 Live draw</span>
                <span className="mode-desc">
                  Everyone’s together, tapping in real time.
                </span>
              </button>
              <button
                type="button"
                className={`mode-opt${mode === "async" ? " selected" : ""}`}
                onClick={() => setMode("async")}
              >
                <span className="mode-title">🍿 Watch anytime</span>
                <span className="mode-desc">
                  Run it once; each player watches the draw on their own time.
                </span>
              </button>
            </div>
          </div>
          <div className="field">
            <label>Betting pot per player</label>
            <PotControl value={startingPot} busy={busy} onChange={setStartingPot} />
          </div>
          <button className="btn big" disabled={busy} onClick={handleCreate}>
            Start a new draw →
          </button>

          <div className="or">or join one</div>

          <div className="field">
            <label>Room code</label>
            <input
              className="code-input"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="WC7K"
              maxLength={4}
            />
          </div>
          <button className="btn ghost" disabled={busy} onClick={handleJoin}>
            Join draw
          </button>

          <div className="err">{err}</div>
        </div>
      </div>

      <nav className="page-nav" aria-label="Leave page">
        <button type="button" className="nav-btn" onClick={onExit}>
          ← Back to menu
        </button>
      </nav>
    </>
  );
}

// ── Room (lobby + drawing + done) ────────────────────────
type RoomData = NonNullable<FunctionReturnType<typeof api.rooms.getRoom>>;

function Room({
  data,
  now,
  onBack,
  onExit,
}: {
  data: RoomData;
  now: number;
  onBack: () => void;
  onExit: () => void;
}) {
  const { room, players, teams, current, viewerId, needsWatch, script } = data;
  const startGame = useMutation(api.rooms.startGame);
  const draw = useMutation(api.rooms.draw);
  const hostDraw = useMutation(api.rooms.hostDraw);
  const autoAllocate = useMutation(api.rooms.autoAllocate);
  const pickAfrican = useMutation(api.rooms.pickAfrican);
  const resetRoom = useMutation(api.rooms.resetRoom);
  const deleteRoom = useMutation(api.rooms.deleteRoom);
  const runAsyncDraw = useMutation(api.rooms.runAsyncDraw);
  const forceLockAsync = useMutation(api.rooms.forceLockAsync);
  const setMode = useMutation(api.rooms.setMode);
  const setTimer = useMutation(api.rooms.setTimer);
  const setPot = useMutation(api.rooms.setPot);
  const setBetVisibility = useMutation(api.betting.setBetVisibility);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [hostSettingsOpen, setHostSettingsOpen] = useState(false);

  const isAsync = room.mode === "async";
  const isHost = room.hostId === viewerId;
  // Live turn-timer settings (host-toggled). Read here so both the lobby config
  // and the in-draw countdown share them.
  const timerEnabled = room.timerEnabled ?? false;
  const timerSeconds = room.timerSeconds ?? DEFAULT_TIMER_SECONDS;
  const entryFee = room.entryFee ?? ENTRY_FEE;
  const pool = entryFee * players.length;
  const startingPot = room.startingPot ?? 0;
  // The pot locks server-side once the first bet is placed; mirror that here so
  // the host's control disables itself instead of failing on submit.
  const potLocked = useQuery(api.rooms.potLocked, { code: room.code }) === true;
  const me = players.find((p) => p.userId === viewerId);
  const myTeams = me
    ? [
        ...teams.filter((t) => t.ownerId === me._id).map((t) => t.name),
        ...(me.africanTeam ? [me.africanTeam.name] : []),
      ]
    : [];

  // Show the viewer's own squad first on the board; everyone else keeps their
  // existing order behind it.
  const orderedPlayers = useMemo(() => {
    if (!viewerId) return players;
    return [
      ...players.filter((p) => p.userId === viewerId),
      ...players.filter((p) => p.userId !== viewerId),
    ];
  }, [players, viewerId]);

  // Map every assigned team (incl. African picks) → its owner's name, so the
  // fixtures list can show who's playing who at a glance.
  const teamOwners = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of teams) {
      if (!t.ownerId) continue;
      const owner = players.find((p) => p._id === t.ownerId);
      if (owner) m[t.name] = owner.name;
    }
    for (const p of players) {
      if (p.africanTeam) m[p.africanTeam.name] = p.name;
    }
    return m;
  }, [teams, players]);

  const revealing = teams.find(
    (t) => t.assignedAt && now < t.assignedAt + REVEAL_MS,
  );
  const revealingOwner = revealing
    ? players.find((p) => p._id === revealing.ownerId)
    : undefined;

  async function handleStart() {
    setBusy(true);
    setErr("");
    try {
      await startGame({ code: room.code });
    } catch (e: any) {
      setErr(e.message ?? "Could not start.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetMode(next: "live" | "async") {
    if (next === room.mode) return;
    setErr("");
    try {
      await setMode({ code: room.code, mode: next });
    } catch (e: any) {
      setErr(e.message ?? "Could not change the draw style.");
    }
  }

  async function handleSetTimer(enabled: boolean, seconds: number) {
    setErr("");
    try {
      await setTimer({ code: room.code, enabled, seconds });
    } catch (e: any) {
      setErr(e.message ?? "Could not change the timer.");
    }
  }

  async function handleSetPot(pot: number) {
    setErr("");
    try {
      await setPot({ code: room.code, startingPot: pot });
    } catch (e: any) {
      setErr(e.message ?? "Could not change the betting pot.");
    }
  }

  async function handleSetBetVisibility(mode: BetVisibility) {
    setErr("");
    try {
      await setBetVisibility({ code: room.code, mode });
    } catch (e: any) {
      setErr(e.message ?? "Could not change bet visibility.");
    }
  }

  async function handleRunAsync() {
    if (
      !confirm(
        "Run the draw now? Teams are assigned instantly and everyone can then watch it play out in their own time.",
      )
    )
      return;
    setBusy(true);
    setErr("");
    try {
      await runAsyncDraw({ code: room.code });
    } catch (e: any) {
      setErr(e.message ?? "Could not run the draw.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForceLock() {
    if (
      !confirm(
        "Lock the draw now? Anyone who never picked an African team gets a random one, and the draw is final.",
      )
    )
      return;
    setBusy(true);
    setErr("");
    try {
      await forceLockAsync({ code: room.code });
    } catch (e: any) {
      setErr(e.message ?? "Could not lock the draw.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDraw() {
    setBusy(true);
    setErr("");
    try {
      await draw({ code: room.code });
    } catch (e: any) {
      setErr(e.message ?? "Could not draw.");
    } finally {
      setBusy(false);
    }
  }

  async function handleHostDraw() {
    setBusy(true);
    setErr("");
    try {
      await hostDraw({ code: room.code });
    } catch (e: any) {
      setErr(e.message ?? "Could not draw for the player.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAutoAllocate() {
    if (
      !confirm(
        "Auto-allocate every remaining team now? This finishes the draw instantly for everyone.",
      )
    )
      return;
    setBusy(true);
    setErr("");
    try {
      await autoAllocate({ code: room.code });
    } catch (e: any) {
      setErr(e.message ?? "Could not auto-allocate.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePickAfrican(teamName: string) {
    setBusy(true);
    setErr("");
    try {
      await pickAfrican({ code: room.code, teamName });
    } catch (e: any) {
      setErr(e.message ?? "Could not pick.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    if (!confirm("Reset the draw back to the lobby for everyone?")) return;
    try {
      await resetRoom({ code: room.code });
    } catch (e: any) {
      setErr(e.message ?? "Could not reset.");
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete “${room.name}” for everyone? This can’t be undone.`))
      return;
    try {
      await deleteRoom({ code: room.code });
      onBack();
    } catch (e: any) {
      setErr(e.message ?? "Could not delete the game.");
    }
  }

  // ── Lobby ──────────────────────────────────────────────
  if (room.status === "lobby") {
    return (
      <>
        <Header
          pool={pool}
          entryFee={entryFee}
          count={players.length}
          teamsEach={TEAMS_EACH}
        />
        <div className="center-stage">
          <div className="panel" style={{ textAlign: "center" }}>
            <div className="game-title">{room.name}</div>
            <p className="hint" style={{ marginBottom: 12 }}>
              Share this code so the others can join
            </p>
            <div className="code-badge">
              <small>Code</small>
              {room.code}
            </div>
            <div className="invite-row">
              <CopyInvite code={room.code} />
            </div>
          </div>

          <div className="panel">
            <h3>In the draw</h3>
            <p className="hint">
              {players.length}/{MAX_PLAYERS} players · R{entryFee} each · pool
              R{pool}
            </p>
            <p className="hint">
              Top {players.length * TIERS} teams play ·{" "}
              {POOL.length - players.length * TIERS} sit out - the field trims to
              fit, so the strongest teams are always in.
            </p>
            <div className="roster">
              {players.map((p, i) => (
                <div className="roster-row" key={p._id}>
                  <span className="num">{i + 1}</span>
                  <Avatar src={p.avatarUrl} name={p.name} size={28} enlargeable />
                  <span>{p.name}</span>
                  {p.userId === viewerId ? (
                    <span className="you">You</span>
                  ) : p.userId === room.hostId ? (
                    <span className="host-tag">Host</span>
                  ) : null}
                </div>
              ))}
            </div>

            {isHost ? (
              <div className="field" style={{ marginTop: 4 }}>
                <label>Draw style</label>
                <div className="mode-toggle">
                  <button
                    type="button"
                    className={`mode-opt${!isAsync ? " selected" : ""}`}
                    disabled={busy}
                    onClick={() => handleSetMode("live")}
                  >
                    <span className="mode-title">🔴 Live draw</span>
                    <span className="mode-desc">
                      Everyone’s together, tapping in real time.
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`mode-opt${isAsync ? " selected" : ""}`}
                    disabled={busy}
                    onClick={() => handleSetMode("async")}
                  >
                    <span className="mode-title">🍿 Watch anytime</span>
                    <span className="mode-desc">
                      Run it once; each player watches on their own time.
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="hint" style={{ marginBottom: 8 }}>
                {isAsync
                  ? "🍿 Watch-anytime draw - you’ll watch it play out on your own time."
                  : "🔴 Live draw - everyone draws together in real time."}
              </p>
            )}
            {isAsync && (
              <p className="hint" style={{ marginBottom: 8 }}>
                🍿 Watch-anytime draw: once you run it, every player watches the
                draw play out whenever they next open the app.
              </p>
            )}
            {!isAsync && isHost && (
              <div className="field" style={{ marginTop: 4 }}>
                <TimerControl
                  enabled={timerEnabled}
                  seconds={timerSeconds}
                  busy={busy}
                  onChange={handleSetTimer}
                />
              </div>
            )}
            {!isAsync && !isHost && timerEnabled && (
              <p className="hint" style={{ marginBottom: 8 }}>
                ⏱️ Turn timer on — {fmtTimer(timerSeconds)} per pick. If you run
                out of time, a team is drawn for you.
              </p>
            )}
            {isHost ? (
              <div className="field" style={{ marginTop: 4 }}>
                <label>💰 Betting pot per player</label>
                <PotControl
                  value={startingPot}
                  busy={busy}
                  onChange={handleSetPot}
                  note="Each player is handed this many points to bet on real World Cup matches. Sit on it, grow it, or gamble it away - it folds into the room score, but never drags you below your draw total."
                />
              </div>
            ) : startingPot > 0 ? (
              <p className="hint" style={{ marginBottom: 8 }}>
                💰 Betting on — you’ll get {startingPot} points to bet on World
                Cup matches once the draw locks.
              </p>
            ) : null}
            {isHost ? (
              <button
                className="btn big"
                disabled={busy || players.length < 2}
                onClick={isAsync ? handleRunAsync : handleStart}
              >
                {players.length < 2
                  ? "Waiting for more players…"
                  : isAsync
                    ? "Run the draw now →"
                    : "Lock it in & start the draw →"}
              </button>
            ) : (
              <button className="btn big" disabled>
                {isAsync
                  ? "Waiting for the host to run the draw…"
                  : "Waiting for the host to start…"}
              </button>
            )}
            {isHost && !isAsync && players.length >= 2 && (
              <button
                className="btn ghost"
                onClick={handleAutoAllocate}
                disabled={busy}
                style={{ marginTop: 10 }}
              >
                Host: skip the draw & auto-allocate everyone
              </button>
            )}
            {isHost && (
              <button
                className="btn danger"
                onClick={handleDelete}
                style={{ marginTop: 10 }}
              >
                Host: delete game
              </button>
            )}
            <div className="err">{err}</div>
          </div>

          {me && (
            <div className="panel">
              <h3>Your African team</h3>
              <p className="hint">
                Pick your bonus African nation - it scores double. You can change
                it any time before the host locks the draw.
              </p>
              <AfricanPicker
                me={me}
                teams={teams}
                busy={busy}
                onPick={handlePickAfrican}
              />
            </div>
          )}
        </div>
        <Fixtures />
        <BackNav onBack={onBack} onExit={onExit} />
      </>
    );
  }

  // ── Async replay: this player hasn't watched their walk-through yet ─────
  // The board/standings/their teams stay hidden until they've played through
  // their own reveal (server withholds owners + sends a playback script).
  if (needsWatch && script) {
    return (
      <>
        <Header
          pool={pool}
          entryFee={entryFee}
          count={players.length}
          teamsEach={TEAMS_EACH}
        />
        <div className="wrap">
          <div className="game-title">{room.name}</div>
        </div>
        <ReplayPlayer
          code={room.code}
          script={script}
          players={players}
          viewerId={viewerId}
        />
        <BackNav onBack={onBack} onExit={onExit} />
      </>
    );
  }

  // ── Drawing / Done ─────────────────────────────────────
  const currentPlayer = current
    ? players.find((p) => p._id === current.playerId)
    : undefined;
  const myTurn = !!currentPlayer && currentPlayer.userId === viewerId;
  const done = room.status === "done";
  // Tier draw finished but the room hasn't locked: still waiting on one or more
  // players to make their off-clock African bonus pick.
  const awaitingAfrican = !done && !current;
  const pendingAfrican = players.filter((p) => !p.africanTeam);

  // The countdown is visible to everyone whenever a turn is on the clock; the
  // server's `turnDeadline` is the source of truth, so all tabs tick down to
  // the same instant.
  const timerActive = timerEnabled && !!current && !!room.turnDeadline && !done;
  const timerRemainingMs = timerActive
    ? Math.max(0, room.turnDeadline! - now)
    : 0;

  return (
    <>
      {revealing && (
        <RevealOverlay
          ownerName={revealingOwner?.name ?? "Someone"}
          tier={revealing.tier}
          flag={revealing.flag}
          teamName={revealing.name}
        />
      )}

      <Header
        pool={pool}
        entryFee={entryFee}
        count={players.length}
        teamsEach={TEAMS_EACH}
      />

      <div className="wrap">
        <div className="game-title">{room.name}</div>
      </div>

      {!done && (
        <div className="wrap">
          <div className="turnbar">
            {awaitingAfrican ? (
              <>
                <div>
                  <div className="turn-label">Almost there</div>
                  <div className="turn-name">
                    {pendingAfrican.length === 1
                      ? `Waiting for ${pendingAfrican[0].name}'s African pick`
                      : `Waiting for ${pendingAfrican.length} African picks`}
                  </div>
                </div>
                <div className="spacer" />
                <span className="turn-label">
                  {me && !me.africanTeam ? "pick yours below ↓" : "almost locked…"}
                </span>
              </>
            ) : myTurn ? (
              <>
                <div>
                  <div className="turn-label">It’s your turn</div>
                  <div className="turn-name">Draw your team</div>
                </div>
                <span
                  className="turn-tier"
                  style={{ background: TIER_VAR[current!.tier] }}
                >
                  {TIER_NAME[current!.tier]}
                </span>
                {timerActive && (
                  <TurnCountdown
                    remainingMs={timerRemainingMs}
                    totalMs={timerSeconds * 1000}
                    mine
                  />
                )}
                <div className="spacer" />
                <button
                  className="btn"
                  disabled={busy || !!revealing}
                  onClick={handleDraw}
                >
                  {revealing ? "Revealing…" : "🎲 Tap to draw"}
                </button>
              </>
            ) : (
              <>
                <div>
                  <div className="turn-label">Now drawing</div>
                  <div className="turn-name">{currentPlayer?.name ?? "-"}</div>
                </div>
                <span
                  className="turn-tier"
                  style={{ background: TIER_VAR[current?.tier ?? 1] }}
                >
                  {TIER_NAME[current?.tier ?? 1]}
                </span>
                {timerActive && (
                  <TurnCountdown
                    remainingMs={timerRemainingMs}
                    totalMs={timerSeconds * 1000}
                    mine={false}
                  />
                )}
                <div className="spacer" />
                {isHost ? (
                  <button
                    className="btn"
                    disabled={busy || !!revealing}
                    onClick={handleHostDraw}
                  >
                    {revealing
                      ? "Revealing…"
                      : `🎲 Draw for ${currentPlayer?.name ?? "player"}`}
                  </button>
                ) : (
                  <span className="turn-label">
                    {revealing ? "🥁 revealing…" : "waiting…"}
                  </span>
                )}
              </>
            )}
          </div>

          {isHost && isAsync && (
            <div style={{ textAlign: "center", marginTop: 8 }}>
              {pendingAfrican.length > 0 && (
                <p className="hint" style={{ marginBottom: 4 }}>
                  {pendingAfrican.length} player
                  {pendingAfrican.length === 1 ? " still owes" : "s still owe"} an
                  African pick.
                </p>
              )}
              <button
                className="leave danger"
                onClick={handleForceLock}
                disabled={busy}
                style={{ textDecoration: "underline" }}
              >
                Host: force-lock now (random for no-shows) →
              </button>
            </div>
          )}

          {isHost && !isAsync && (
            <div className="timer-control-wrap">
              <TimerControl
                enabled={timerEnabled}
                seconds={timerSeconds}
                busy={busy}
                compact
                onChange={handleSetTimer}
              />
            </div>
          )}

          {isHost && !isAsync && (
            <button
              className="leave"
              onClick={handleAutoAllocate}
              disabled={busy}
              style={{ textDecoration: "underline", marginTop: 8 }}
            >
              Host: auto-allocate the rest →
            </button>
          )}

          {me && (
            <div className="afr-pick-block">
              <div className="afr-pick-head">
                {me.africanTeam
                  ? "Your African bonus team (scores double) - tap to change:"
                  : "Pick your African bonus team (scores double) - any time before the draw locks:"}
              </div>
              <AfricanPicker
                me={me}
                teams={teams}
                busy={busy}
                onPick={handlePickAfrican}
              />
            </div>
          )}

          {err && (
            <div className="err" style={{ textAlign: "center" }}>
              {err}
            </div>
          )}
        </div>
      )}

      {done && (
        <section className="wrap">
          <div className="banner">
            <h3>The draw is locked ✓</h3>
            <p>
              {players.length} squads set · pool of <b>R{pool}</b> · may the
              best squad win. Good luck! 🍀
            </p>
          </div>
        </section>
      )}

      {/* Host's entry point to game settings (betting pot, reset, delete) -
          opens a modal so the controls don't float between sections. */}
      {isHost && (
        <div className="wrap host-settings-bar">
          <button
            type="button"
            className="host-settings-btn"
            onClick={() => setHostSettingsOpen(true)}
          >
            ⚙ Host settings
          </button>
        </div>
      )}

      {/* Players board */}
      <CollapsibleSection
        id="squads"
        title="The Squads"
        subtitle="one per tier · plus an African pick (double points)"
      >
        <div className="players">
          {orderedPlayers.map((p) => (
            <PlayerCard
              key={p._id}
              player={p}
              isMe={p.userId === viewerId}
              isTurn={!!currentPlayer && currentPlayer._id === p._id && !done}
              teams={teams}
              now={now}
              teamsEach={TEAMS_EACH}
              entryFee={entryFee}
            />
          ))}
        </div>
      </CollapsibleSection>

      {/* Standings - live once the draw is locked and results roll in */}
      {done && (
        <Standings code={room.code} viewerId={viewerId} pot={startingPot} />
      )}

      {/* Betting - real-match wagers against each player's bankroll */}
      {done && startingPot > 0 && (
        <BettingSection
          code={room.code}
          isHost={room.hostId === viewerId}
          betVisibility={roomBetVisibility(room)}
        />
      )}

      {/* Once the draw is locked, fixtures are the headline - surface them
          above the pools and left-out lists. */}
      {done && <Fixtures myTeams={myTeams} owners={teamOwners} />}

      {/* Tier pools */}
      <CollapsibleSection
        id="pots"
        title="The Pots"
        subtitle="what’s left in each tier"
      >
        <div className="tiers">
          {[1, 2, 3].map((tier) => {
            const tierTeams = teams
              .filter((t) => t.tier === tier)
              .sort((a, b) => a.name.localeCompare(b.name));
            const left = tierTeams.filter((t) => !t.ownerId).length;
            return (
              <div className="tier" key={tier}>
                <div className="tier-top">
                  <div className="tier-name">
                    <span className={`pip t${tier}`} />
                    {TIER_NAME[tier]}
                  </div>
                  <div className="tier-num">{left} left</div>
                </div>
                <div className="teamlist">
                  {tierTeams.map((t) => {
                    const owner = t.ownerId
                      ? players.find((p) => p._id === t.ownerId)
                      : undefined;
                    const revealed =
                      !t.assignedAt || now >= t.assignedAt + REVEAL_MS;
                    const taken = !!t.ownerId && revealed;
                    return (
                      <div
                        className={`team${taken ? " taken" : ""}`}
                        key={t._id}
                      >
                        <span className="flag">{t.flag}</span>
                        {t.name}
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
      </CollapsibleSection>

      {/* Teams cut to fit the player count - shown so it's clear what's out */}
      {(() => {
        const cut = teams
          .filter((t) => t.tier === 0)
          .sort(
            (a, b) =>
              (RANK_BY_NAME[a.name] ?? 99) - (RANK_BY_NAME[b.name] ?? 99),
          );
        if (cut.length === 0) return null;
        return (
          <CollapsibleSection
            id="leftout"
            title="Left out"
            subtitle={`${cut.length} team${cut.length === 1 ? "" : "s"} cut to fit ${players.length} players - top ${players.length * TIERS} play`}
          >
            <div className="teamlist cutlist">
              {cut.map((t) => (
                <div className="team cut" key={t._id}>
                  <span className="flag">{t.flag}</span>
                  {t.name}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        );
      })()}

      {/* Before lock, fixtures sit below the pools (shown here only). */}
      {!done && <Fixtures myTeams={myTeams} owners={teamOwners} />}

      {isHost && hostSettingsOpen && (
        <HostSettingsModal
          done={done}
          startingPot={startingPot}
          betVisibility={roomBetVisibility(room)}
          busy={busy}
          potLocked={potLocked}
          err={err}
          onSetPot={handleSetPot}
          onSetBetVisibility={handleSetBetVisibility}
          onReset={handleReset}
          onDelete={handleDelete}
          onClose={() => setHostSettingsOpen(false)}
        />
      )}
      <BackNav onBack={onBack} onExit={onExit} />
    </>
  );
}

// ── Page nav ─────────────────────────────────────────────
// The "back" links shown at the foot of every room view. Styled as white pill
// buttons so they read as deliberate navigation and stay legible on the photo
// background, matching the rest of the app's card aesthetic.
function BackNav({
  onBack,
  onExit,
}: {
  onBack: () => void;
  onExit: () => void;
}) {
  return (
    <nav className="page-nav" aria-label="Leave game">
      <button type="button" className="nav-btn" onClick={onBack}>
        ← My games
      </button>
      <button type="button" className="nav-btn" onClick={onExit}>
        ← Back to menu
      </button>
    </nav>
  );
}

// ── Host settings modal ──────────────────────────────────
// The host's control room: betting pot, reset, and delete, behind one button so
// these controls don't float between the page's section cards. Betting can only
// be configured once the draw is locked (the server refuses pot changes mid-draw
// and bets can't be placed until then), so before lock it shows a disabled note.
function HostSettingsModal({
  done,
  startingPot,
  betVisibility,
  busy,
  potLocked,
  err,
  onSetPot,
  onSetBetVisibility,
  onReset,
  onDelete,
  onClose,
}: {
  done: boolean;
  startingPot: number;
  betVisibility: BetVisibility;
  busy: boolean;
  potLocked: boolean;
  err: string;
  onSetPot: (pot: number) => void;
  onSetBetVisibility: (mode: BetVisibility) => void;
  onReset: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Lock body scroll and wire Escape-to-close while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="host-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Host settings"
      onClick={onClose}
    >
      <div className="host-modal" onClick={(e) => e.stopPropagation()}>
        <div className="host-modal-head">
          <h3>⚙ Host settings</h3>
          <button
            type="button"
            className="host-modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="host-modal-block">
          <label className="pot-host-label">💰 Betting pot per player</label>
          {done ? (
            <PotControl
              value={startingPot}
              busy={busy || potLocked}
              onChange={onSetPot}
              note={
                potLocked
                  ? "🔒 Locked — players have placed bets."
                  : startingPot > 0
                    ? "Editable until the first bet is placed, then locked."
                    : "Turn betting on for this room — players can back the remaining fixtures."
              }
            />
          ) : (
            <p className="host-modal-note">
              Betting opens once the draw is locked — you'll set the pot here
              when the squads are final.
            </p>
          )}
        </div>

        {done && startingPot > 0 && (
          <div className="host-modal-block">
            <BetVisibilityControl
              value={betVisibility}
              busy={busy}
              onChange={onSetBetVisibility}
            />
          </div>
        )}

        <div className="host-modal-block">
          <div className="host-modal-block-title">Danger zone</div>
          <button type="button" className="btn ghost" onClick={onReset}>
            Reset draw to lobby
          </button>
          <button
            type="button"
            className="btn ghost host-modal-danger"
            onClick={onDelete}
          >
            Delete game
          </button>
        </div>

        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}

// ── Standings ────────────────────────────────────────────
// 3 pts win · 1 draw · 0 loss, African team doubled. Empty until matches play.
function Standings({
  code,
  viewerId,
  pot,
}: {
  code: string;
  viewerId: RoomData["viewerId"];
  pot: number;
}) {
  const rows = useQuery(api.results.standings, { code });
  if (rows === undefined || rows === null) return null;

  const anyResults = rows.some(
    (r) => r.teams.some((t) => t.played > 0) || (r.african?.played ?? 0) > 0,
  );
  const bettingOn = pot > 0;

  return (
    <CollapsibleSection
      id="standings"
      title="Standings"
      subtitle={
        bettingOn
          ? "3 win · 1 draw · 0 loss · African ×2 · plus betting bankroll"
          : "3 win · 1 draw · 0 loss · African team scores double"
      }
    >
      {!anyResults && (
        <p className="hint" style={{ marginBottom: 14 }}>
          No results yet - points appear here as World Cup matches are played.
        </p>
      )}

      <div className="standings">
        {rows.map((r, i) => {
          const isMe = r.userId === viewerId;
          return (
            <div className={`stand-row${isMe ? " me" : ""}`} key={r.playerId}>
              <span className="stand-rank">{i + 1}</span>
              <Avatar src={r.avatarUrl} name={r.name} size={30} enlargeable />
              <div className="stand-main">
                <div className="stand-name">
                  {r.name}
                  {isMe && <span className="badge-you">You</span>}
                </div>
                <div className="stand-teams">
                  {r.african && (
                    <span className="stand-team afr" title="African pick ×2">
                      <span className="flag">{r.african.flag}</span>
                      {r.african.points}×
                    </span>
                  )}
                  {r.teams.map((t) => (
                    <span className="stand-team" key={t.name}>
                      <span className="flag">{t.flag}</span>
                      {t.points}
                    </span>
                  ))}
                  {bettingOn && r.bettingOn && (
                    <span
                      className="stand-team bank"
                      title={
                        isMe
                          ? `Betting bankroll: ${r.bankroll}${r.pendingStakes > 0 ? ` (${r.pendingStakes} in play)` : ""}`
                          : "Betting bankroll"
                      }
                    >
                      💰 {r.bankroll}
                      {isMe && r.pendingStakes > 0 && (
                        <span className="bank-inplay">
                          · {r.pendingStakes} in play
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </div>
              <span className="stand-pts">
                {r.total}
                <small>pts</small>
              </span>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}

// ── Betting ──────────────────────────────────────────────
// A dedicated section in the locked-room view: the viewer's bankroll header,
// the bettable World Cup fixtures (priced per outcome), and their own open +
// settled bets. Picks are private (the server only ever returns the viewer's
// own); bankroll totals are public via Standings.
type BettableMatch = FunctionReturnType<
  typeof api.betting.bettableMatches
>[number];
type MyBet = FunctionReturnType<typeof api.betting.myBets>[number];

// Host-chosen bet visibility (mirrors the server union in convex/betting.ts).
type BetVisibility = "hidden" | "live" | "public";

// Effective visibility for a room, falling back to the legacy `betsPublic`
// boolean for rooms created before the three-way `betVisibility` field.
function roomBetVisibility(room: RoomData["room"]): BetVisibility {
  return room.betVisibility ?? (room.betsPublic ? "public" : "hidden");
}

const BET_VISIBILITY_OPTIONS: { mode: BetVisibility; label: string }[] = [
  { mode: "hidden", label: "Hidden" },
  { mode: "live", label: "When live" },
  { mode: "public", label: "Public" },
];

const BET_VISIBILITY_NOTE: Record<BetVisibility, string> = {
  hidden: "Bets are private — each player only sees their own.",
  live: "Each player’s bet is revealed to everyone once its match kicks off.",
  public: "Everyone can see each player’s picks, stakes and odds.",
};

// Host control for the room's three-way bet visibility, used both in the
// betting panel and the host-settings modal. Segmented selector + a note that
// explains the active mode.
function BetVisibilityControl({
  value,
  busy,
  onChange,
}: {
  value: BetVisibility;
  busy?: boolean;
  onChange: (mode: BetVisibility) => void;
}) {
  return (
    <div className="bet-visibility-row">
      <div className="bet-visibility-text">
        <span className="bet-visibility-label">👀 Show everyone’s bets</span>
        <span className="bet-visibility-note">{BET_VISIBILITY_NOTE[value]}</span>
      </div>
      <div className="bet-vis-seg" role="group" aria-label="Bet visibility">
        {BET_VISIBILITY_OPTIONS.map((o) => (
          <button
            key={o.mode}
            type="button"
            className={`bet-vis-seg-btn${value === o.mode ? " on" : ""}`}
            aria-pressed={value === o.mode}
            disabled={busy}
            onClick={() => onChange(o.mode)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const PICK_LABEL: Record<BetPick, string> = {
  HOME: "Home",
  DRAW: "Draw",
  AWAY: "Away",
};

// Local calendar day for a fixture (e.g. "Sat, 14 Jun"), used to group the
// bettable list by matchday so we can show just the soonest one by default.
function fixtureDay(utcDate: string): string {
  return new Date(utcDate).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function BettingSection({
  code,
  isHost,
  betVisibility,
}: {
  code: string;
  isHost: boolean;
  betVisibility: BetVisibility;
}) {
  const bankroll = useQuery(api.betting.myBankroll, { code });
  const matches = useQuery(api.betting.bettableMatches, { code });
  const bets = useQuery(api.betting.myBets, { code });
  // Populated by the server unless visibility is "hidden"; in "live" mode it
  // only carries bets whose match has kicked off.
  const roomBets = useQuery(api.betting.roomBets, { code });
  const placeBet = useMutation(api.betting.placeBet);
  const cancelBet = useMutation(api.betting.cancelBet);
  const setBetVisibility = useMutation(api.betting.setBetVisibility);
  const [err, setErr] = useState("");
  // Fixtures are long-ranging, so default to just the soonest matchday and let
  // the player reveal further fixtures a few at a time. `extra` counts how many
  // fixtures beyond that base matchday the player has chosen to reveal.
  const REVEAL_STEP = 5;
  const [extra, setExtra] = useState(0);

  const available = bankroll?.available ?? 0;

  // `matches` is server-sorted by utcDate, so the first entry's day is the next
  // matchday. The base view is just that day's fixtures (contiguous at the
  // front); `extra` reveals the following fixtures in steps of REVEAL_STEP.
  const nextDay = matches?.[0] ? fixtureDay(matches[0].utcDate) : null;
  const baseCount = matches
    ? matches.filter((m) => fixtureDay(m.utcDate) === nextDay).length
    : 0;
  const visibleCount = baseCount + extra;
  const shownMatches =
    matches === undefined ? matches : matches.slice(0, visibleCount);
  const hiddenCount = matches ? Math.max(0, matches.length - visibleCount) : 0;
  // How many the next reveal will add (the final step may be a short one).
  const nextChunk = Math.min(REVEAL_STEP, hiddenCount);

  async function handlePlace(matchExtId: number, pick: BetPick, stake: number) {
    setErr("");
    try {
      await placeBet({ code, matchExtId, pick, stake });
    } catch (e: any) {
      setErr(e.message ?? "Could not place the bet.");
    }
  }

  async function handleCancel(matchExtId: number) {
    setErr("");
    try {
      await cancelBet({ code, matchExtId });
    } catch (e: any) {
      setErr(e.message ?? "Could not cancel the bet.");
    }
  }

  async function handleSetVisibility(mode: BetVisibility) {
    setErr("");
    try {
      await setBetVisibility({ code, mode });
    } catch (e: any) {
      setErr(e.message ?? "Could not change bet visibility.");
    }
  }

  // Split bets into current (still-open: scheduled or live) and history
  // (finished/settled). `open` is the server's per-bet flag. Applies to the
  // viewer's own bets and to every exposed player group, in all modes.
  // The viewer's own group is excluded here — they're already shown in the
  // dedicated "Your bets" sections, so showing it again would duplicate it.
  const myCurrent = (bets ?? []).filter((b) => b.open);
  const myHistory = (bets ?? []).filter((b) => !b.open);
  const splitGroups = (pred: (b: MyBet) => boolean) =>
    (roomBets ?? [])
      .filter((g) => !g.isMe)
      .map((g) => ({ ...g, bets: g.bets.filter(pred) }))
      .filter((g) => g.bets.length > 0);
  const roomCurrent = splitGroups((b) => b.open);
  const roomHistory = splitGroups((b) => !b.open);
  const hasHistory = myHistory.length > 0 || roomHistory.length > 0;

  return (
    <CollapsibleSection
      id="betting"
      title="Betting"
      subtitle="back real World Cup results · winnings fold into the standings"
    >
      {bankroll && (
        <div className="bank-header">
          <div className="bank-stat">
            <span className="bank-num">{available}</span>
            <span className="bank-lbl">available</span>
          </div>
          <div className="bank-stat">
            <span className="bank-num">{bankroll.pendingStakes}</span>
            <span className="bank-lbl">in play</span>
          </div>
          <div
            className={`bank-stat${bankroll.settledNet > 0 ? " up" : bankroll.settledNet < 0 ? " down" : ""}`}
          >
            <span className="bank-num">
              {bankroll.settledNet > 0 ? "+" : ""}
              {bankroll.settledNet}
            </span>
            <span className="bank-lbl">settled P&amp;L</span>
          </div>
        </div>
      )}

      {isHost && (
        <BetVisibilityControl
          value={betVisibility}
          onChange={handleSetVisibility}
        />
      )}

      {err && <div className="err">{err}</div>}

      <h4 className="bet-subhead">
        Bettable fixtures
        {extra === 0 && nextDay && shownMatches && shownMatches.length > 0 && (
          <span className="bet-subhead-note"> · {nextDay}</span>
        )}
      </h4>
      {matches === undefined ? (
        <p className="hint">Loading…</p>
      ) : matches.length === 0 ? (
        <p className="hint">
          No open fixtures to bet on right now - check back when the next round
          is scheduled.
        </p>
      ) : (
        <>
          <div className="bet-matches">
            {shownMatches!.map((m) => (
              <BetRow
                key={m.matchExtId}
                m={m}
                available={available}
                onPlace={handlePlace}
                onCancel={handleCancel}
              />
            ))}
          </div>
          {(hiddenCount > 0 || extra > 0) && (
            <div className="bet-reveal-row">
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="bet-showall-btn"
                  onClick={() =>
                    setExtra((e) => Math.min(e + REVEAL_STEP, matches.length))
                  }
                >
                  Show next {nextChunk} fixture{nextChunk === 1 ? "" : "s"}
                </button>
              )}
              {extra > 0 && (
                <button
                  type="button"
                  className="bet-showall-btn ghost"
                  onClick={() => setExtra(0)}
                >
                  Hide
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/* Current bets: still-open picks (upcoming + live). Finished bets drop
          down to the history section below. */}
      {myCurrent.length > 0 && (
        <>
          <h4 className="bet-subhead">Your bets</h4>
          <div className="bet-list">
            {myCurrent.map((b) => (
              <MyBetRow key={b.matchExtId} b={b} />
            ))}
          </div>
        </>
      )}

      {roomCurrent.length > 0 && (
        <>
          <h4 className="bet-subhead">Everyone’s bets</h4>
          <div className="bet-everyone">
            {roomCurrent.map((g) => (
              <div key={g.playerId} className="bet-player-group">
                <div className="bpg-name">
                  {g.name}
                  {g.isMe && <span className="bpg-you">you</span>}
                </div>
                <div className="bet-list">
                  {g.bets.map((b) => (
                    <MyBetRow key={b.matchExtId} b={b} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* History: bets on finished matches, kept out of the live section. Each
          player is a collapsed group that expands to its newest 5 settled bets,
          then loads 10 more at a time — keeps a long tournament's history short
          by default. */}
      {hasHistory && (
        <div className="bet-history">
          <h4 className="bet-subhead">Bet history</h4>
          {myHistory.length > 0 && (
            <CollapsibleBetGroup
              name="Your bets"
              isMe
              bets={myHistory}
              total={myHistory.length}
              net={myHistory.reduce((s, b) => s + b.settledNet, 0)}
            />
          )}
          {roomHistory.length > 0 && (
            <div className="bet-everyone">
              {roomHistory.map((g) => (
                <CollapsibleBetGroup
                  key={g.playerId}
                  name={g.name}
                  isMe={g.isMe}
                  bets={g.bets}
                  total={g.settledTotal}
                  net={g.settledNet}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

// A single bettable fixture: outcome buttons priced with their odds, a whole-
// number stake input, and place/edit/cancel. Local draft state seeds from any
// existing bet so editing feels in-place.
function BetRow({
  m,
  available,
  onPlace,
  onCancel,
}: {
  m: BettableMatch;
  available: number;
  onPlace: (matchExtId: number, pick: BetPick, stake: number) => void;
  onCancel: (matchExtId: number) => void;
}) {
  const [pick, setPick] = useState<BetPick | null>(m.myBet?.pick ?? null);
  const [stakeStr, setStakeStr] = useState(
    m.myBet ? String(m.myBet.stake) : "",
  );
  const stake = Math.floor(Number(stakeStr));

  // Replacing this match's existing bet frees its held stake, so the cap is the
  // available bankroll plus whatever's already staked here.
  const maxStake = available + (m.myBet?.stake ?? 0);
  const stakeValid = Number.isInteger(stake) && stake >= 1 && stake <= maxStake;
  const chosenOdds =
    pick && m.odds[pick] !== undefined ? (m.odds[pick] as number) : null;
  const potential = chosenOdds && stakeValid ? Math.round(stake * chosenOdds) : null;

  const outcomes: BetPick[] = m.isKnockout
    ? ["HOME", "AWAY"]
    : ["HOME", "DRAW", "AWAY"];

  const kickoff = new Date(m.utcDate).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="bet-match">
      <div className="bm-teams">
        <span className="bm-team">
          <span className="flag">{m.homeFlag}</span>
          {m.homeTeam}
        </span>
        <span className="bm-v">v</span>
        <span className="bm-team away">
          {m.awayTeam}
          <span className="flag">{m.awayFlag}</span>
        </span>
      </div>
      <div className="bm-meta">
        {kickoff}
        {m.live && (
          <span className="bm-live" title="Live market odds, averaged across bookmakers">
            ● Live odds
          </span>
        )}
      </div>
      <div className="bm-odds">
        {outcomes.map((o) => {
          const odd = m.odds[o] as number;
          const label =
            o === "HOME" ? m.homeTeam : o === "AWAY" ? m.awayTeam : "Draw";
          return (
            <button
              key={o}
              type="button"
              className={`odd-btn${pick === o ? " selected" : ""}`}
              onClick={() => setPick(o)}
            >
              <span className="odd-label">{label}</span>
              <span className="odd-x">×{odd.toFixed(2)}</span>
            </button>
          );
        })}
      </div>
      <div className="bm-stake">
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={maxStake}
          step={1}
          placeholder="Stake"
          value={stakeStr}
          onChange={(e) => setStakeStr(e.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={!pick || !stakeValid}
          onClick={() => pick && onPlace(m.matchExtId, pick, stake)}
        >
          {m.myBet ? "Update bet" : "Place bet"}
        </button>
        {m.myBet && (
          <button
            type="button"
            className="btn ghost"
            onClick={() => onCancel(m.matchExtId)}
          >
            Cancel
          </button>
        )}
      </div>
      <div className="bm-foot">
        {potential != null ? (
          <span>
            Returns <b>{potential}</b> if it lands ({PICK_LABEL[pick!]})
          </span>
        ) : maxStake < 1 ? (
          <span className="hint">No bankroll left to stake.</span>
        ) : (
          <span className="hint">Pick an outcome and a whole-number stake.</span>
        )}
        {m.myBet && (
          <span className="bm-current">
            Current: {PICK_LABEL[m.myBet.pick]} · {m.myBet.stake} @ ×
            {m.myBet.odds.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

// One row in "Your bets": resolved match, the pick, and the open potential or
// the settled win/loss.
function MyBetRow({ b }: { b: MyBet }) {
  const cls = b.open ? "open" : b.won ? "won" : "lost";
  return (
    <div className={`bet-row ${cls}`}>
      <span className="flag">{b.homeFlag}</span>
      <span className="flag">{b.awayFlag}</span>
      <span className="br-match">
        {b.homeTeam} v {b.awayTeam}
      </span>
      <span className="br-pick">
        {PICK_LABEL[b.pick]} · {b.stake} @ ×{b.odds.toFixed(2)}
      </span>
      <span className={`br-result ${cls}`}>
        {b.open
          ? `to return ${b.potentialReturn}`
          : b.won
            ? `won +${b.settledNet}`
            : `lost ${b.settledNet}`}
      </span>
    </div>
  );
}

// A collapsed bet-history group for one player. Header shows the name plus a
// settled-bet count and net P/L; expanding reveals the newest 5 bets, with
// "Load more" paging 10 at a time up to whatever the server returned (`bets`
// may be capped below `total` — see HISTORY_WINDOW in convex/betting.ts).
const HISTORY_PAGE = 10;
function CollapsibleBetGroup({
  name,
  isMe,
  bets,
  total,
  net,
}: {
  name: string;
  isMe: boolean;
  bets: MyBet[]; // settled bets, newest first
  total: number; // total settled count (may exceed bets.length when capped)
  net: number; // net P/L across all settled bets
}) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(5);
  const netCls = net > 0 ? "won" : net < 0 ? "lost" : "";
  return (
    <div className="bet-player-group">
      <button
        type="button"
        className="bpg-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="bpg-name">
          {name}
          {isMe && <span className="bpg-you">you</span>}
        </span>
        <span className="bpg-summary">
          <span className="bpg-count">
            {total} {total === 1 ? "bet" : "bets"}
          </span>
          {net !== 0 && (
            <span className={`bpg-net ${netCls}`}>
              {net > 0 ? `+${net}` : net}
            </span>
          )}
          <span className="bpg-chev" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
        </span>
      </button>
      {open && (
        <>
          <div className="bet-list">
            {bets.slice(0, visible).map((b) => (
              <MyBetRow key={b.matchExtId} b={b} />
            ))}
          </div>
          {visible < bets.length && (
            <button
              type="button"
              className="bpg-more"
              onClick={() => setVisible((v) => v + HISTORY_PAGE)}
            >
              Load more
            </button>
          )}
        </>
      )}
    </div>
  );
}

// The African bonus picker - a free, off-the-clock choice every player makes for
// themselves. Highlights the current pick and blocks any nation the player has
// already drawn from a tier, so the bonus team never duplicates a drawn one.
function AfricanPicker({
  me,
  teams,
  busy,
  onPick,
}: {
  me: RoomData["players"][number];
  teams: RoomData["teams"];
  busy: boolean;
  onPick: (name: string) => void;
}) {
  return (
    <div className="african-picker">
      {AFRICAN_POOL.map((t) => {
        const selected = me.africanTeam?.name === t.name;
        const drawn = teams.some(
          (tt) => tt.ownerId === me._id && tt.name === t.name,
        );
        return (
          <button
            key={t.name}
            className={`afr-btn${selected ? " selected" : ""}`}
            disabled={busy || (drawn && !selected)}
            title={drawn && !selected ? "You already drew this team" : undefined}
            onClick={() => onPick(t.name)}
          >
            <span className="flag">{t.flag}</span>
            {t.name}
            {selected && <span className="afr-check">✓</span>}
          </button>
        );
      })}
    </div>
  );
}

function PlayerCard({
  player,
  isMe,
  isTurn,
  teams,
  now,
  teamsEach,
  entryFee,
}: {
  player: RoomData["players"][number];
  isMe: boolean;
  isTurn: boolean;
  teams: RoomData["teams"];
  now: number;
  teamsEach: number;
  entryFee: number;
}) {
  // Exactly one team per tier now, so a fixed three-slot layout reads cleanly.
  const mine = teams.filter((t) => t.ownerId === player._id);
  const afr = player.africanTeam;
  const revealedCount = mine.filter(
    (t) => !t.assignedAt || now >= t.assignedAt + REVEAL_MS,
  ).length;
  const shown = revealedCount + (afr ? 1 : 0);

  return (
    <div className={`player${isTurn ? " is-turn" : ""}`}>
      <div className="pname">
        <Avatar src={player.avatarUrl} name={player.name} size={26} enlargeable />
        {player.name}
        {afr && (
          <span className="afr-flag" title={`African pick: ${afr.name}`}>
            {afr.flag}
          </span>
        )}
        {isMe && <span className="badge-you">You</span>}
      </div>
      <div className="pstake">
        R{entryFee} in · {shown}/{teamsEach} teams
      </div>
      <div className="draw">
        {afr ? (
          <div className="drawteam afr">
            <span className="flag">{afr.flag}</span>
            {afr.name}
            <span className="tag afr-tag">Africa ×2</span>
          </div>
        ) : (
          <div className="drawteam empty">African pick · to choose</div>
        )}
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

// ── Async replay player ──────────────────────────────────
// Drives a local playback cursor over the script returned by getRoom. Other
// players' picks auto-reveal quickly; the watcher's own turn pauses for a tap
// and dwells longer. On reaching the end it calls markWatched, which clears the
// server-side spoiler gate so the parent re-renders the real board.
type ScriptStep = NonNullable<RoomData["script"]>[number];

function ReplayPlayer({
  code,
  script,
  players,
  viewerId,
}: {
  code: string;
  script: ScriptStep[];
  players: RoomData["players"];
  viewerId: RoomData["viewerId"];
}) {
  const markWatched = useMutation(api.rooms.markWatched);
  const myPlayerId = players.find((p) => p.userId === viewerId)?._id;
  const nameOf = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of players) m[p._id] = p.name;
    return m;
  }, [players]);

  const [cursor, setCursor] = useState(0);
  // Whether the watcher has tapped to start their own (paused) reveal.
  const [tapped, setTapped] = useState(false);

  const finished = cursor >= script.length;
  const step = finished ? null : script[cursor];
  const mine = !!step && step.playerId === myPlayerId;

  useEffect(() => {
    if (finished) {
      void markWatched({ code });
      return;
    }
    // The watcher's own turn waits for a tap before it reveals.
    if (mine && !tapped) return;
    const dwell = mine ? ASYNC_MINE_MS : ASYNC_OTHERS_MS;
    const t = setTimeout(() => {
      setTapped(false);
      setCursor((c) => c + 1);
    }, dwell);
    return () => clearTimeout(t);
  }, [cursor, mine, tapped, finished, code, markWatched]);

  // Picks already played through, newest first, as a running feed.
  const revealed = script.slice(0, cursor);

  const showOverlay = !finished && (!mine || tapped);

  return (
    <>
      {showOverlay && step && (
        <RevealOverlay
          key={step.pickIndex}
          ownerName={mine ? "You" : (nameOf[step.playerId] ?? "Someone")}
          tier={step.tier}
          flag={step.flag}
          teamName={step.teamName}
          spinMs={mine ? undefined : 600}
          verb={mine ? "got" : "drew"}
        />
      )}

      <div className="wrap">
        <div className="replay-head">
          <div className="turn-label">🍿 Watch your draw</div>
          <div className="turn-name">
            {finished
              ? "That’s your squad!"
              : `Pick ${cursor + 1} of ${script.length}`}
          </div>
        </div>

        {finished ? (
          <div className="banner">
            <h3>All done ✓</h3>
            <p>Loading your squad and the full board…</p>
          </div>
        ) : mine && !tapped ? (
          <div className="replay-myturn">
            <div className="replay-myturn-label">It’s your turn</div>
            <p className="hint">
              Tap the dice to draw your{" "}
              {TIER_NAME[step!.tier].toLowerCase()} team.
            </p>
            <button className="btn big" onClick={() => setTapped(true)}>
              🎲 Tap to draw
            </button>
          </div>
        ) : (
          <div className="replay-waiting">
            <span className="turn-label">
              {mine ? "🥁 revealing yours…" : "🥁 revealing…"}
            </span>
          </div>
        )}

        {revealed.length > 0 && (
          <div className="replay-feed">
            {revealed
              .slice()
              .reverse()
              .map((s) => {
                const isMine = s.playerId === myPlayerId;
                return (
                  <div
                    className={`replay-row${isMine ? " me" : ""}`}
                    key={s.pickIndex}
                  >
                    <span className="flag">{s.flag}</span>
                    <span className="replay-team">{s.teamName}</span>
                    <span className="replay-owner">
                      {isMine ? "You" : (nameOf[s.playerId] ?? "—")}
                    </span>
                    <span
                      className="tag"
                      style={{ background: TIER_VAR[s.tier] }}
                    >
                      T{s.tier}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </>
  );
}
