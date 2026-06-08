import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { REVEAL_MS, ENTRY_FEE, MAX_PLAYERS, AFRICAN_POOL } from "../convex/pool";
import { Avatar, Header, RevealOverlay, TIER_VAR, TIER_NAME } from "./shared";

// Each player tracks four teams: one African pick plus one per tier.
const TEAMS_EACH = 4;
import Fixtures from "./FixturesView";

// ── Live mode (auth + Convex provider live in App.tsx) ───
// Routes between the games list and an individual room.
export default function LiveApp({ onExit }: { onExit: () => void }) {
  const [code, setCode] = useState<string | null>(
    () => localStorage.getItem("wc_room"),
  );

  const data = useQuery(
    api.rooms.getRoom,
    code ? { code } : { code: undefined },
  );

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 120);
    return () => clearInterval(t);
  }, []);

  // Stale room code (deleted/unknown): drop it and fall back to the list.
  useEffect(() => {
    if (code && data === null) localStorage.removeItem("wc_room");
  }, [code, data]);

  function enterRoom(c: string) {
    localStorage.setItem("wc_room", c);
    setCode(c);
  }
  function backToList() {
    localStorage.removeItem("wc_room");
    setCode(null);
  }

  if (!code) return <GamesList onEnter={enterRoom} onExit={onExit} />;
  if (data === undefined) return <div className="center-stage" />;
  if (data === null) {
    return (
      <GamesList
        onEnter={enterRoom}
        onExit={onExit}
        notice="That game no longer exists — start a fresh one."
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
  const [gameName, setGameName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [err, setErr] = useState(notice || "");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!gameName.trim()) return setErr("Give your draw a name.");
    setBusy(true);
    setErr("");
    try {
      const { code } = await createRoom({ name: gameName.trim() });
      onEnter(code);
    } catch (e: any) {
      setErr(e.message ?? "Could not create the game.");
    } finally {
      setBusy(false);
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
          Every draw you’re in, in one place — friends, family, work, whatever.
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
              No games yet — create one below or join with a code.
            </p>
          ) : (
            <div className="games">
              {games.map((g) => (
                <button
                  className="gamecard"
                  key={g.code}
                  onClick={() => onEnter(g.code)}
                >
                  <div className="gc-main">
                    <span className="gc-name">{g.name}</span>
                    <span className="gc-meta">
                      <span className="gc-code">{g.code}</span>·{" "}
                      {g.playerCount} player{g.playerCount === 1 ? "" : "s"}
                      {g.isHost ? " · host" : ""}
                    </span>
                  </div>
                  <span className={`status-pill ${g.status}`}>
                    {STATUS_LABEL[g.status]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="field">
            <label>New draw — give it a name</label>
            <input
              value={gameName}
              onChange={(e) => setGameName(e.target.value)}
              placeholder="e.g. Family draw"
              maxLength={30}
            />
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
  const { room, players, teams, current, viewerId } = data;
  const startGame = useMutation(api.rooms.startGame);
  const draw = useMutation(api.rooms.draw);
  const pickAfrican = useMutation(api.rooms.pickAfrican);
  const resetRoom = useMutation(api.rooms.resetRoom);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const isHost = room.hostId === viewerId;
  const pool = ENTRY_FEE * players.length;
  const me = players.find((p) => p.userId === viewerId);
  const myTeams = me
    ? [
        ...teams.filter((t) => t.ownerId === me._id).map((t) => t.name),
        ...(me.africanTeam ? [me.africanTeam.name] : []),
      ]
    : [];

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

  // ── Lobby ──────────────────────────────────────────────
  if (room.status === "lobby") {
    return (
      <>
        <Header pool={pool} count={players.length} teamsEach={TEAMS_EACH} />
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
          </div>

          <div className="panel">
            <h3>In the draw</h3>
            <p className="hint">
              {players.length}/{MAX_PLAYERS} players · R{ENTRY_FEE} each · pool
              R{pool}
            </p>
            <div className="roster">
              {players.map((p, i) => (
                <div className="roster-row" key={p._id}>
                  <span className="num">{i + 1}</span>
                  <Avatar src={p.avatarUrl} name={p.name} size={28} />
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
              <button
                className="btn big"
                disabled={busy || players.length < 2}
                onClick={handleStart}
              >
                {players.length < 2
                  ? "Waiting for more players…"
                  : "Lock it in & start the draw →"}
              </button>
            ) : (
              <button className="btn big" disabled>
                Waiting for the host to start…
              </button>
            )}
            <div className="err">{err}</div>
          </div>
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

  // ── Drawing / Done ─────────────────────────────────────
  const currentPlayer = current
    ? players.find((p) => p._id === current.playerId)
    : undefined;
  const myTurn = !!currentPlayer && currentPlayer.userId === viewerId;
  const isAfrican = current?.phase === "african";
  const done = room.status === "done";

  return (
    <>
      {revealing && (
        <RevealOverlay
          ownerName={revealingOwner?.name ?? "Someone"}
          tier={revealing.tier}
        />
      )}

      <Header pool={pool} count={players.length} teamsEach={TEAMS_EACH} />

      <div className="wrap">
        <div className="game-title">{room.name}</div>
      </div>

      {!done && (
        <div className="wrap">
          <div className="turnbar">
            {myTurn ? (
              <>
                <div>
                  <div className="turn-label">It’s your turn</div>
                  <div className="turn-name">
                    {isAfrican ? "Choose your African team" : "Draw your team"}
                  </div>
                </div>
                <span
                  className="turn-tier"
                  style={{
                    background: isAfrican
                      ? "var(--tier3)"
                      : TIER_VAR[current!.tier],
                  }}
                >
                  {isAfrican ? "African bonus" : TIER_NAME[current!.tier]}
                </span>
                <div className="spacer" />
                {isAfrican ? (
                  <span className="turn-label">pick below ↓</span>
                ) : (
                  <button
                    className="btn"
                    disabled={busy || !!revealing}
                    onClick={handleDraw}
                  >
                    {revealing ? "Revealing…" : "🎲 Tap to draw"}
                  </button>
                )}
              </>
            ) : (
              <>
                <div>
                  <div className="turn-label">
                    {isAfrican ? "Bonus round" : "Now drawing"}
                  </div>
                  <div className="turn-name">{currentPlayer?.name ?? "—"}</div>
                </div>
                <span
                  className="turn-tier"
                  style={{
                    background: isAfrican
                      ? "var(--tier3)"
                      : TIER_VAR[current?.tier ?? 1],
                  }}
                >
                  {isAfrican ? "African bonus" : TIER_NAME[current?.tier ?? 1]}
                </span>
                <div className="spacer" />
                <span className="turn-label">
                  {isAfrican
                    ? "choosing…"
                    : revealing
                      ? "🥁 revealing…"
                      : "waiting…"}
                </span>
              </>
            )}
          </div>

          {myTurn && isAfrican && (
            <div className="african-picker">
              {AFRICAN_POOL.map((t) => (
                <button
                  key={t.name}
                  className="afr-btn"
                  disabled={busy}
                  onClick={() => handlePickAfrican(t.name)}
                >
                  <span className="flag">{t.flag}</span>
                  {t.name}
                </button>
              ))}
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
      <section className="section wrap">
        <div className="shead">
          <h2>The Squads</h2>
          <span>one per tier · plus an African pick (double points)</span>
          <div className="rule" />
        </div>
        <div className="players">
          {players.map((p) => (
            <PlayerCard
              key={p._id}
              player={p}
              isMe={p.userId === viewerId}
              isTurn={!!currentPlayer && currentPlayer._id === p._id && !done}
              teams={teams}
              now={now}
              teamsEach={TEAMS_EACH}
            />
          ))}
        </div>
      </section>

      {/* Standings — live once the draw is locked and results roll in */}
      {done && <Standings code={room.code} viewerId={viewerId} />}

      {/* Tier pools */}
      <section className="section wrap">
        <div className="shead">
          <h2>The Pots</h2>
          <span>what’s left in each tier</span>
          <div className="rule" />
        </div>
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
      </section>

      <Fixtures myTeams={myTeams} />

      {isHost && (
        <div className="wrap" style={{ textAlign: "center" }}>
          <button
            className="leave"
            onClick={handleReset}
            style={{ textDecoration: "underline" }}
          >
            Host: reset draw
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
    <section className="section wrap">
      <div className="shead">
        <h2>Standings</h2>
        <span>3 win · 1 draw · 0 loss · African team scores double</span>
        <div className="rule" />
      </div>

      {!anyResults && (
        <p className="hint" style={{ marginBottom: 14 }}>
          No results yet — points appear here as World Cup matches are played.
        </p>
      )}

      <div className="standings">
        {rows.map((r, i) => {
          const isMe = r.userId === viewerId;
          return (
            <div className={`stand-row${isMe ? " me" : ""}`} key={r.playerId}>
              <span className="stand-rank">{i + 1}</span>
              <Avatar src={r.avatarUrl} name={r.name} size={30} />
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
    </section>
  );
}

function PlayerCard({
  player,
  isMe,
  isTurn,
  teams,
  now,
  teamsEach,
}: {
  player: RoomData["players"][number];
  isMe: boolean;
  isTurn: boolean;
  teams: RoomData["teams"];
  now: number;
  teamsEach: number;
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
        <Avatar src={player.avatarUrl} name={player.name} size={26} />
        {player.name}
        {afr && (
          <span className="afr-flag" title={`African pick: ${afr.name}`}>
            {afr.flag}
          </span>
        )}
        {isMe && <span className="badge-you">You</span>}
      </div>
      <div className="pstake">
        R{ENTRY_FEE} in · {shown}/{teamsEach} teams
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
