import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  Authenticated,
  AuthLoading,
  ConvexReactClient,
  Unauthenticated,
  useMutation,
  useQuery,
} from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { api } from "../convex/_generated/api";
import AuthScreen from "./AuthScreen";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";
import IntroTour from "./IntroTour";
import MyAccount from "./MyAccount";
import HowItWorks from "./HowItWorks";
import WorldCupFacts from "./WorldCupFacts";
import Fixtures from "./FixturesView";
import { sastDate, sastTime } from "./fixtures";

// The room UI is the heavy part of the app. Loading it lazily keeps the
// landing → auth → welcome flow lean.
const LiveApp = lazy(() => import("./LiveApp"));

// ── Top level: log in first, then into the draw ──────────
export default function App() {
  const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
  const client = useMemo(
    () => (url ? new ConvexReactClient(url) : null),
    [url],
  );

  if (!client) return <BackendNotConnected />;

  return (
    <ConvexAuthProvider client={client}>
      <AuthLoading>
        <div className="center-stage" />
      </AuthLoading>
      <Unauthenticated>
        <AuthScreen />
      </Unauthenticated>
      <Authenticated>
        <BrowserRouter>
          <SiteHeader />
          {/* One-time guided walkthrough on first login (skipped for invitees). */}
          <IntroTour />
          <Routes>
            <Route path="/games" element={<GamesHome />} />
            <Route path="/games/:code" element={<GamesHome />} />
            <Route path="/join/:code" element={<JoinGame />} />
            <Route path="/standings" element={<StandingsPage />} />
            <Route path="/fixtures" element={<FixturesPage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/facts" element={<WorldCupFacts />} />
            <Route path="/account" element={<MyAccount />} />
            <Route path="*" element={<Navigate to="/games" replace />} />
          </Routes>
          <SiteFooter />
        </BrowserRouter>
      </Authenticated>
    </ConvexAuthProvider>
  );
}

// ── Fixtures page - reuses the shared schedule component ─────
function FixturesPage() {
  return (
    <>
      <header className="wrap">
        <div className="kicker">Tournament · 2026</div>
        <h1>
          The <em>fixtures</em>
        </h1>
        <p className="sub">
          All 104 matches, kick-off times in SAST. Open any match day for the
          full schedule.
        </p>
      </header>
      <Fixtures />
    </>
  );
}

// ── Standings page - the 12 World Cup groups, live from football-data.org ─
function StandingsPage() {
  const groups = useQuery(api.results.groups);
  return (
    <>
      <header className="wrap">
        <div className="kicker">Tournament · 2026</div>
        <h1>
          The <em>standings</em>
        </h1>
        <p className="sub">
          All twelve groups, updated live through the tournament. 3 pts a win, 1
          a draw - the table that decides every squad’s fate.
        </p>
      </header>

      <div className="wrap">
        {groups === undefined ? (
          <p className="hint">Loading standings…</p>
        ) : groups.length === 0 ? (
          <p className="hint">
            Standings will appear here once the group draw is published.
          </p>
        ) : (
          <div className="groups">
            {groups.map((g) => (
              <GroupTable key={g.group} group={g.group} table={g.table} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

type GroupTableData = NonNullable<
  ReturnType<typeof useQuery<typeof api.results.groups>>
>[number];

function GroupTable({
  group,
  table,
}: {
  group: string;
  table: GroupTableData["table"];
}) {
  return (
    <section className="grouptable">
      <div className="gt-title">{group}</div>
      <div className="gt-scroll">
        <div className="gt-grid">
          <div className="gt-head">
            <span className="gt-team">Team</span>
            <span>P</span>
            <span>W</span>
            <span>D</span>
            <span>L</span>
            <span>GF</span>
            <span>GA</span>
            <span>GD</span>
            <span className="gt-pts">Pts</span>
            <span className="gt-form">Form</span>
          </div>
          {table.map((r) => (
            <div className="gt-row" key={r.teamName}>
              <span className="gt-team">
                <span className="gt-pos">{r.position}</span>
                <span className="flag">{r.flag}</span>
                <span className="gt-name">{r.teamName}</span>
              </span>
              <span>{r.played}</span>
              <span>{r.won}</span>
              <span>{r.draw}</span>
              <span>{r.lost}</span>
              <span>{r.goalsFor}</span>
              <span>{r.goalsAgainst}</span>
              <span>{r.goalDifference}</span>
              <span className="gt-pts">{r.points}</span>
              <span className="gt-form">{r.form ?? "– – – – –"}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Results page - every kicked-off match, newest first, live from football-data.org ─
function ResultsPage() {
  const matches = useQuery(api.results.recentMatches);

  // Group the (already newest-first) list into match days by SAST date.
  const days = useMemo(() => {
    if (!matches) return [];
    const out: { date: string; items: typeof matches }[] = [];
    for (const m of matches) {
      const d = sastDate(m.utcDate);
      const last = out[out.length - 1];
      if (last && last.date === d) last.items.push(m);
      else out.push({ date: d, items: [m] });
    }
    return out;
  }, [matches]);

  return (
    <>
      <header className="wrap">
        <div className="kicker">Tournament · 2026</div>
        <h1>
          The <em>results</em>
        </h1>
        <p className="sub">
          Every match that’s kicked off, freshest first — full-time scores and
          anything live right now, updated through the tournament.
        </p>
      </header>

      <div className="wrap">
        {matches === undefined ? (
          <p className="hint">Loading results…</p>
        ) : days.length === 0 ? (
          <p className="hint">
            No matches have kicked off yet. Scores will land here the moment the
            first whistle blows.
          </p>
        ) : (
          <div className="res-days">
            {days.map((d) => (
              <section className="res-day" key={d.date}>
                <div className="res-dayhead">{d.date}</div>
                <div className="res-list">
                  {d.items.map((m) => (
                    <ResultRow key={m.id} m={m} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

type MatchResult = NonNullable<
  ReturnType<typeof useQuery<typeof api.results.recentMatches>>
>[number];

function ResultRow({ m }: { m: MatchResult }) {
  const hasScore = m.homeGoals !== null && m.awayGoals !== null;
  return (
    <div className="res-row">
      <div
        className={`res-side${m.winner === "HOME" ? " win" : m.winner === "AWAY" ? " lose" : ""}`}
      >
        <span className="res-flag">{m.homeFlag ?? "🏳️"}</span>
        <span className="res-name">{m.homeTeam}</span>
      </div>

      <div className="res-score">
        {hasScore ? (
          <span className="res-nums">
            {m.homeGoals}
            <span className="res-dash">–</span>
            {m.awayGoals}
          </span>
        ) : (
          <span className="res-vs">v</span>
        )}
        {m.live ? (
          <span className="res-live">● Live</span>
        ) : (
          <span className="res-ft">FT</span>
        )}
      </div>

      <div
        className={`res-side r${m.winner === "AWAY" ? " win" : m.winner === "HOME" ? " lose" : ""}`}
      >
        <span className="res-name">{m.awayTeam}</span>
        <span className="res-flag">{m.awayFlag ?? "🏳️"}</span>
      </div>

      <div className="res-meta">
        <span className="res-stage">{m.stage}</span>
        <span className="res-time">{sastTime(m.utcDate)}</span>
      </div>
    </div>
  );
}

function BackendNotConnected() {
  return (
    <>
      <header className="wrap">
        <div className="kicker">World Cup Draw · 2026</div>
        <h1>
          Almost <em>there</em>
        </h1>
      </header>
      <div className="center-stage">
        <div className="panel">
          <h3>Backend not connected</h3>
          <p className="hint">
            This app needs Convex. In a terminal run <b>npx convex dev</b> once
            (it writes <b>.env.local</b>), then restart <b>npm run dev</b>.
          </p>
        </div>
      </div>
    </>
  );
}

// ── /games: a branded front door, then into the live draw ─
function GamesHome() {
  const [entered, setEntered] = useState(
    () => localStorage.getItem("wc_entered") === "1",
  );
  function enter() {
    localStorage.setItem("wc_entered", "1");
    setEntered(true);
  }
  function exit() {
    localStorage.removeItem("wc_entered");
    setEntered(false);
  }

  if (!entered) return <Welcome onEnter={enter} />;
  return (
    <Suspense fallback={<div className="center-stage" />}>
      <LiveApp onExit={exit} />
    </Suspense>
  );
}

// ── /join/:code - an invite link. Auto-joins, then drops into the room ─
// This route lives inside <Authenticated>, so a logged-out friend hits the
// auth gate first; the URL is preserved through login and this runs after.
function JoinGame() {
  const { code } = useParams();
  const navigate = useNavigate();
  const joinRoom = useMutation(api.rooms.joinRoom);
  const markIntroSeen = useMutation(api.account.markIntroSeen);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      if (!code) return navigate("/games", { replace: true });
      // Following an invite means you're entering the draw - skip the splash,
      // and skip the first-login walkthrough (we mark it seen before routing in
      // so the tour never flashes over the room they came to join).
      localStorage.setItem("wc_entered", "1");
      await markIntroSeen().catch(() => {});
      // Try to join as a player. If that's blocked (the draw already started,
      // or the room is full) we still open the room so they can watch - only a
      // genuinely missing room sends them back to the list (handled by the
      // room view, which bounces to /games when getRoom returns null).
      try {
        await joinRoom({ code });
      } catch {
        /* not a member and can't join now - fall through to spectate */
      }
      if (!cancelled) navigate(`/games/${code}`, { replace: true });
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, [code]);

  return <div className="center-stage" />;
}

function Welcome({ onEnter }: { onEnter: () => void }) {
  return (
    <>
      <header className="wrap pick-head">
        <h1>
          The luck of the <em>draw</em>
        </h1>
        <p className="sub">
          Forty-eight nations, three pots, one blind draw. Set your buy-in,
          three teams each - best trio takes the pot.
        </p>
      </header>

      <div className="center-stage landing-stage">
        <div className="panel" style={{ textAlign: "center" }}>
          <h3>Kick-off</h3>
          <p className="hint">
            Everyone on their own phone. Share a code, draw live, winner takes
            the pot.
          </p>
          <button className="btn big" onClick={onEnter}>
            Enter the draw →
          </button>
        </div>
      </div>
    </>
  );
}
