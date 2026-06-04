import { useEffect, useMemo, useState } from "react";
import {
  Authenticated,
  AuthLoading,
  ConvexReactClient,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../convex/_generated/api";
import { REVEAL_MS, ENTRY_FEE, MAX_PLAYERS, TIERS } from "../convex/pool";
import { Header, RevealOverlay, TIER_VAR, TIER_NAME } from "./shared";
import Fixtures from "./FixturesView";

// ── Live mode: mount Convex + Auth only here ─────────────
export default function LiveApp({ onExit }: { onExit: () => void }) {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  const client = useMemo(
    () => (url ? new ConvexReactClient(url) : null),
    [url],
  );

  if (!client) return <BackendNotConnected onExit={onExit} />;

  return (
    <ConvexAuthProvider client={client}>
      <AuthLoading>
        <div className="center-stage" />
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen onExit={onExit} />
      </Unauthenticated>
      <Authenticated>
        <SignedIn onExit={onExit} />
      </Authenticated>
    </ConvexAuthProvider>
  );
}

function BackendNotConnected({ onExit }: { onExit: () => void }) {
  return (
    <>
      <header className="wrap">
        <div className="kicker">Live match play</div>
        <h1>
          Almost <em>there</em>
        </h1>
      </header>
      <div className="center-stage">
        <div className="panel">
          <h3>Backend not connected</h3>
          <p className="hint">
            Live mode needs Convex. In a terminal run <b>npx convex dev</b> once
            (it writes <b>.env.local</b>), then restart <b>npm run dev</b>. Or
            just use the local one-device game — no setup needed.
          </p>
          <button className="btn ghost" onClick={onExit}>
            ← Back to menu
          </button>
        </div>
      </div>
    </>
  );
}

// ── Sign in / sign up ────────────────────────────────────
function AuthScreen({ onExit }: { onExit: () => void }) {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const isSignUp = flow === "signUp";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (isSignUp && !name.trim()) return setErr("Pop your name in first.");
    if (!email.trim()) return setErr("Enter your email.");
    if (password.length < 8)
      return setErr("Password needs at least 8 characters.");
    setBusy(true);
    setErr("");
    try {
      await signIn(
        "password",
        isSignUp
          ? { name: name.trim(), email: email.trim(), password, flow }
          : { email: email.trim(), password, flow },
      );
      // On success the <Authenticated> branch takes over automatically.
    } catch {
      setErr(
        isSignUp
          ? "Couldn’t sign up — that email may already be registered."
          : "Wrong email or password.",
      );
      setBusy(false);
    }
  }

  return (
    <>
      <header className="wrap">
        <div className="kicker">Live match play · 2026</div>
        <h1>
          The World Cup <em>Draw</em>
        </h1>
        <p className="sub">
          Sign in to see your draws — friends, family, the lot — and jump into
          any of them. R{ENTRY_FEE} in, three teams each, winner takes the pot.
        </p>
      </header>

      <div className="center-stage">
        <div className="panel">
          <h3>{isSignUp ? "Create your account" : "Welcome back"}</h3>
          <p className="hint">
            {isSignUp
              ? "One account, all your games — on any device."
              : "Sign in to pick up your draws."}
          </p>

          <form onSubmit={submit}>
            {isSignUp && (
              <div className="field">
                <label>Your name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Luc"
                  maxLength={18}
                />
              </div>
            )}

            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="8+ characters"
                autoComplete={isSignUp ? "new-password" : "current-password"}
              />
            </div>

            <button className="btn big" disabled={busy} type="submit">
              {isSignUp ? "Sign up →" : "Sign in →"}
            </button>
            <div className="err">{err}</div>
          </form>

          <div className="authtoggle">
            {isSignUp ? "Already have an account?" : "New here?"}{" "}
            <button
              type="button"
              onClick={() => {
                setErr("");
                setFlow(isSignUp ? "signIn" : "signUp");
              }}
            >
              {isSignUp ? "Sign in" : "Create one"}
            </button>
          </div>
        </div>
      </div>

      <button className="leave" onClick={onExit}>
        ← Back to menu
      </button>
    </>
  );
}

// ── Signed in: route between the games list and a room ───
function SignedIn({ onExit }: { onExit: () => void }) {
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
  const { signOut } = useAuthActions();
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

      <button className="leave" onClick={() => void signOut()}>
        Sign out
      </button>
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
  const resetRoom = useMutation(api.rooms.resetRoom);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const isHost = room.hostId === viewerId;
  const pool = ENTRY_FEE * players.length;
  const me = players.find((p) => p.userId === viewerId);
  const myTeams = me
    ? teams.filter((t) => t.ownerId === me._id).map((t) => t.name)
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
        <Header pool={pool} count={players.length} />
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
  const done = room.status === "done";

  return (
    <>
      {revealing && (
        <RevealOverlay
          ownerName={revealingOwner?.name ?? "Someone"}
          tier={revealing.tier}
        />
      )}

      <Header pool={pool} count={players.length} />

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
                  <div className="turn-name">{currentPlayer?.name ?? "—"}</div>
                </div>
                <span
                  className="turn-tier"
                  style={{ background: TIER_VAR[current?.tier ?? 1] }}
                >
                  {TIER_NAME[current?.tier ?? 1]}
                </span>
                <div className="spacer" />
                <span className="turn-label">
                  {revealing ? "🥁 revealing…" : "waiting…"}
                </span>
              </>
            )}
          </div>
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
              best group of three win. Good luck! 🍀
            </p>
          </div>
        </section>
      )}

      {/* Players board */}
      <section className="section wrap">
        <div className="shead">
          <h2>The Squads</h2>
          <span>three teams each · one per tier</span>
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
            />
          ))}
        </div>
      </section>

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

function PlayerCard({
  player,
  isMe,
  isTurn,
  teams,
  now,
}: {
  player: RoomData["players"][number];
  isMe: boolean;
  isTurn: boolean;
  teams: RoomData["teams"];
  now: number;
}) {
  const mine = teams
    .filter((t) => t.ownerId === player._id)
    .sort((a, b) => a.tier - b.tier);
  const shown = mine.filter(
    (t) => !t.assignedAt || now >= t.assignedAt + REVEAL_MS,
  ).length;

  return (
    <div className={`player${isTurn ? " is-turn" : ""}`}>
      <div className="pname">
        {player.name}
        {isMe && <span className="badge-you">You</span>}
      </div>
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
