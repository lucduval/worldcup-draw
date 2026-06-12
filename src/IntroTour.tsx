import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../convex/_generated/api";
import { BETTING, MODES, ScoringGrid, STEPS } from "./guideContent";

// ── First-login walkthrough ───────────────────────────────────────────
// A one-time modal tour that opens automatically the first time an account
// signs in, stepping a brand-new player through the whole game before they
// touch anything. It reuses the exact same copy as the "How it works" page
// (see guideContent.tsx) so the two never drift.
//
// It does NOT open for someone arriving via an invite link - they came to join
// a specific draw, so we drop them straight into the room and mark the intro
// seen there (see App.tsx / JoinGame). Anyone can replay the guide any time
// from the "How it works" menu item.

type Slide = {
  kicker: string;
  badge: string; // number for a step, emoji for everything else
  title: string;
  body?: string;
  node?: React.ReactNode; // optional richer content (e.g. the scoring grid)
};

const SLIDES: Slide[] = [
  {
    kicker: "Welcome",
    badge: "👋",
    title: "The World Cup Draw",
    body: "You and your mates each draw three random teams. Follow the matches through the tournament, and whoever's squad scores the most takes the pot. Takes a minute to learn.",
  },
  // The six core steps, numbered just like the guide page.
  ...STEPS.map(
    (s, i): Slide => ({
      kicker: `Step ${i + 1} of ${STEPS.length}`,
      badge: String(i + 1),
      title: s.title,
      body: s.body,
      node: <div className="hiw-art">{s.art}</div>,
    }),
  ),
  {
    kicker: "Two ways to draw",
    badge: "🎲",
    title: "Live, or watch anytime",
    node: (
      <>
        <ul className="hiw-steps tour-modes">
          {MODES.map((m) => (
            <li className="hiw-step" key={m.title}>
              <span className="hiw-num hiw-ico">{m.icon}</span>
              <div>
                <h3>{m.title}</h3>
                <p>{m.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="hint" style={{ marginTop: 14 }}>
          The host picks the style and can switch it in the lobby. Either way the
          teams are random and the scoring's identical.
        </p>
      </>
    ),
  },
  {
    kicker: "Scoring",
    badge: "🏅",
    title: "How points work",
    node: (
      <>
        <ScoringGrid />
        <p className="hint" style={{ marginTop: 14 }}>
          Your total is every team's points added together - with your African
          pick counted twice. Highest total when the World Cup ends wins.
        </p>
      </>
    ),
  },
  {
    kicker: "Optional extra",
    badge: "💰",
    title: BETTING.title,
    node: (
      <>
        <p className="tour-text">{BETTING.intro}</p>
        <ul className="hiw-betting-list">
          {BETTING.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="hiw-art">{BETTING.art}</div>
      </>
    ),
  },
  {
    kicker: "You're all set",
    badge: "⚽",
    title: "Ready to play",
    body: "That's the whole game. Create a draw or join one with a code to get started. You can reopen this guide any time from “How it works” in the menu.",
  },
];

export default function IntroTour() {
  const me = useQuery(api.account.me);
  const markSeen = useMutation(api.account.markIntroSeen);
  const { pathname } = useLocation();

  const [closed, setClosed] = useState(false);
  const [i, setI] = useState(0);

  // Invite landings route straight into a room - don't interrupt them here.
  const onInvite = pathname.startsWith("/join");
  const open = !!me && me.seenIntro === false && !onInvite && !closed;

  // Lock body scroll while the tour is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const last = i === SLIDES.length - 1;
  const slide = SLIDES[i];

  function finish() {
    setClosed(true);
    void markSeen();
  }

  return (
    <div className="tour-backdrop" role="dialog" aria-modal="true" aria-label="How the World Cup Draw works">
      <div className="tour-card">
        <div className="tour-top">
          <span className="tour-kicker">{slide.kicker}</span>
          <button
            type="button"
            className="tour-skip"
            onClick={finish}
          >
            Skip
          </button>
        </div>

        {/* Pinned heading: badge + title stay put on every slide. */}
        <div className="tour-head">
          <span className={`hiw-num${/^\d+$/.test(slide.badge) ? "" : " hiw-ico"} tour-badge`}>
            {slide.badge}
          </span>
          <h2 className="tour-title">{slide.title}</h2>
        </div>

        {/* Only the slide body + mockup scroll - keyed so it resets to the top
            each time the slide changes. */}
        <div className="tour-scroll" key={i}>
          <div className="tour-slidecontent">
            {slide.body && <p className="tour-text">{slide.body}</p>}
            {slide.node}
          </div>
        </div>

        <div className="tour-dots" aria-hidden="true">
          {SLIDES.map((_, n) => (
            <span key={n} className={`tour-dot${n === i ? " on" : ""}`} />
          ))}
        </div>

        <div className="tour-nav">
          {i > 0 ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => setI((n) => n - 1)}
            >
              Back
            </button>
          ) : (
            <span />
          )}
          {last ? (
            <button type="button" className="btn" onClick={finish}>
              Let's go →
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => setI((n) => n + 1)}
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
