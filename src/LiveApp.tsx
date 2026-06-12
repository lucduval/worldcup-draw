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

      <button className="leave" onClick={onExit}>
        ← Back to menu
      </button>
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
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const isAsync = room.mode === "async";
  const isHost = room.hostId === viewerId;
  const entryFee = room.entryFee ?? ENTRY_FEE;
  const pool = entryFee * players.length;
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
                className="leave"
                onClick={handleAutoAllocate}
                disabled={busy}
                style={{ textDecoration: "underline", marginTop: 8 }}
              >
                Host: skip the draw & auto-allocate everyone
              </button>
            )}
            {isHost && (
              <button
                className="leave danger"
                onClick={handleDelete}
                style={{ textDecoration: "underline", marginTop: 8 }}
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
        <button className="leave" onClick={onBack}>
          ← My games
        </button>
        <button className="leave" onClick={onExit}>
          ← Back to menu
        </button>
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
        <button className="leave" onClick={onBack}>
          ← My games
        </button>
        <button className="leave" onClick={onExit}>
          ← Back to menu
        </button>
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
      {done && <Standings code={room.code} viewerId={viewerId} />}

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

      <Fixtures myTeams={myTeams} owners={teamOwners} />

      {isHost && (
        <div className="wrap" style={{ textAlign: "center" }}>
          <button
            className="leave"
            onClick={handleReset}
            style={{ textDecoration: "underline" }}
          >
            Host: reset draw
          </button>
          <button
            className="leave danger"
            onClick={handleDelete}
            style={{ textDecoration: "underline" }}
          >
            Host: delete game
          </button>
        </div>
      )}
      <button className="leave" onClick={onBack}>
        ← My games
      </button>
      <button className="leave" onClick={onExit}>
        ← Back to menu
      </button>
    </>
  );
}

// ── Standings ────────────────────────────────────────────
// 3 pts win · 1 draw · 0 loss, African team doubled. Empty until matches play.
function Standings({
  code,
  viewerId,
}: {
  code: string;
  viewerId: RoomData["viewerId"];
}) {
  const rows = useQuery(api.results.standings, { code });
  if (rows === undefined || rows === null) return null;

  const anyResults = rows.some(
    (r) => r.teams.some((t) => t.played > 0) || (r.african?.played ?? 0) > 0,
  );

  return (
    <CollapsibleSection
      id="standings"
      title="Standings"
      subtitle="3 win · 1 draw · 0 loss · African team scores double"
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
