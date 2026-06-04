import { Suspense, lazy, useState } from "react";
import { ENTRY_FEE } from "../convex/pool";
import LocalGame from "./LocalGame";
import Fixtures from "./FixturesView";

// Live mode pulls in Convex (and convex/_generated). Loading it lazily keeps
// the local one-device game fully independent of any backend setup.
const LiveApp = lazy(() => import("./LiveApp"));

type Mode = "live" | "local";

export default function App() {
  const [mode, setMode] = useState<Mode | null>(
    () => (localStorage.getItem("wc_mode") as Mode | null) ?? null,
  );
  function choose(m: Mode) {
    localStorage.setItem("wc_mode", m);
    setMode(m);
  }
  function back() {
    localStorage.removeItem("wc_mode");
    setMode(null);
  }

  if (mode === "local") return <LocalGame onExit={back} />;
  if (mode === "live")
    return (
      <Suspense fallback={<div className="center-stage" />}>
        <LiveApp onExit={back} />
      </Suspense>
    );
  return <ModePicker onChoose={choose} />;
}

function ModePicker({ onChoose }: { onChoose: (m: Mode) => void }) {
  return (
    <>
      <header className="wrap">
        <div className="kicker">Friends’ Sweepstake · 2026</div>
        <h1>
          The World Cup <em>Draw</em>
        </h1>
        <p className="sub">
          Forty-eight nations, three tiers, blind allocation. R{ENTRY_FEE} in,
          three teams each, taken in turns — winner takes the pot.
        </p>
      </header>

      <div className="center-stage">
        <div className="panel">
          <h3>Live match play</h3>
          <p className="hint">
            Everyone on their own phone. Share a room code, draws sync across
            devices in real time, each player gets their own suspense reveal.
            (Needs the Convex backend running.)
          </p>
          <button className="btn big" onClick={() => onChoose("live")}>
            Play across phones →
          </button>
        </div>

        <div className="panel">
          <h3>Local game · one device</h3>
          <p className="hint">
            Set up the whole draw on this laptop, add the players, and pass it
            around — the draw goes turn by turn on this screen. No internet, no
            setup.
          </p>
          <button className="btn big dark" onClick={() => onChoose("local")}>
            Run it on this device →
          </button>
        </div>
      </div>

      <Fixtures />

      <footer className="wrap">
        Friendly sweepstake · no house edge · for the mates, not the office
      </footer>
    </>
  );
}
