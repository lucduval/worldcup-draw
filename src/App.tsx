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
import MyAccount from "./MyAccount";
import HowItWorks from "./HowItWorks";
import WorldCupFacts from "./WorldCupFacts";
import Fixtures from "./FixturesView";

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

// ── Results page - placeholder until scores go live ─────────
function ResultsPage() {
  return (
    <>
      <header className="wrap">
        <div className="kicker">Tournament · 2026</div>
        <h1>
          The <em>results</em>
        </h1>
      </header>
      <div className="center-stage">
        <div className="panel" style={{ textAlign: "center" }}>
          <h3>Coming soon</h3>
          <p className="hint">
            Live scores and standings will land here once the tournament kicks
            off. Check back closer to the first whistle.
          </p>
        </div>
      </div>
    </>
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

  useEffect(() => {
    let cancelled = false;
    async function go() {
      if (!code) return navigate("/games", { replace: true });
      // Following an invite means you're entering the draw - skip the splash.
      localStorage.setItem("wc_entered", "1");
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

      <div className="center-stage">
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
