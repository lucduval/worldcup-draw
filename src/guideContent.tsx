import type { ReactNode } from "react";
import { ENTRY_FEE, TIERS } from "../convex/pool";
import {
  AfricanPickMock,
  BettingMock,
  CreateJoinMock,
  DrawMock,
  FollowMock,
  LeaderboardMock,
  PotMock,
} from "./GuideMockups";

// ── Shared guide content ──────────────────────────────────────────────
// One source of truth for the rules, draw styles, navigation and scoring,
// reused by the full "How it works" page (HowItWorks.tsx) and the one-time
// first-login walkthrough (IntroTour.tsx). Keep the copy plain and short -
// it's written for someone opening the app for the very first time. Each step
// carries an `art` mockup (GuideMockups.tsx) so both surfaces show the same
// where-to-tap visuals.

// The whole game, start to finish, in six numbered steps.
export const STEPS: { title: string; body: string; art: ReactNode }[] = [
  {
    title: "Start a draw, or join one",
    body: "One person creates the draw - they name it and set the buy-in. Everyone else joins with the 4-letter code, or by tapping the invite link the host shares.",
    art: <CreateJoinMock />,
  },
  {
    title: "Everyone pays the same buy-in",
    body: `Each player puts in the same amount (the host sets it - the default is R${ENTRY_FEE}). Added together, that's the pot - and the winner takes the whole thing.`,
    art: <PotMock />,
  },
  {
    title: "Pick your African team",
    body: "Before the draw locks, every player picks one African nation. It's a free bonus pick on top of your drawn teams - and every point it earns counts double.",
    art: <AfricanPickMock />,
  },
  {
    title: "Draw your three teams",
    body: `The nations are split into ${TIERS} pots - strong, middle and outsiders. You're randomly handed one team from each pot, so everyone ends up with three. No choosing and no skill - it's pure luck of the draw.`,
    art: <DrawMock />,
  },
  {
    title: "Follow the real matches",
    body: "As the World Cup is played, your teams earn points automatically from the real-world results. The Standings and Results pages always show where everyone stands.",
    art: <FollowMock />,
  },
  {
    title: "Best squad takes the pot",
    body: "When the tournament ends, whoever's teams scored the most points wins - and takes the entire pot. That's the whole game.",
    art: <LeaderboardMock />,
  },
];

// Betting - an optional layer the host can switch on. Documented separately
// because it sits on top of the core game rather than being one of the steps.
export const BETTING: { title: string; intro: string; points: string[]; art: ReactNode } = {
  title: "Betting (optional)",
  intro:
    "If the host turns it on, every player also gets a small pool of bonus points to bet on real World Cup matches. It folds straight into the leaderboard - a hot streak can overturn the draw, but it can never drag you below your drawn-teams score.",
  points: [
    "Tap an outcome (home win, draw or away win) - each shows its odds.",
    "Stake whole points from your pool; bigger odds pay more if it lands.",
    "Bets settle automatically when the real match finishes.",
    "Sit on your points to stay safe, or gamble them to climb. Free to change a bet until kick-off.",
  ],
  art: <BettingMock />,
};

// The two draw styles the host can pick (and switch between) in the lobby.
export const MODES: { icon: string; title: string; body: string }[] = [
  {
    icon: "🔴",
    title: "Live draw — together",
    body: "Everyone's online at the same time and takes turns tapping to draw, live. Like being in the room together.",
  },
  {
    icon: "🍿",
    title: "Watch anytime — solo",
    body: "Can't all meet up? The host draws everything at once, then each person opens the app whenever suits them and watches their teams appear.",
  },
];

// The top menu, explained one line at a time.
export const NAV: { icon: string; title: string; body: string }[] = [
  {
    icon: "🎲",
    title: "My games",
    body: "Create a draw, join one with a code, and open any of your rooms to draw and see your teams.",
  },
  {
    icon: "📖",
    title: "How it works",
    body: "This guide - the rules, the two draw styles and the scoring. Pop back any time.",
  },
  {
    icon: "📊",
    title: "Standings",
    body: "All twelve World Cup groups, updated live as matches are played.",
  },
  {
    icon: "🗓️",
    title: "Fixtures",
    body: "Every match and kick-off time, in South African time.",
  },
  {
    icon: "⚽",
    title: "Results",
    body: "Final scores and anything live right now, freshest first.",
  },
  {
    icon: "✨",
    title: "WC facts",
    body: "Fun bits and trivia about the tournament.",
  },
];

// The football scoring, as a small grid. Shared so the page and the tour can't
// drift apart on the numbers.
export function ScoringGrid() {
  return (
    <div className="hiw-scoring">
      <div className="hiw-score">
        <span className="hiw-pts">3</span>
        <span className="hiw-lbl">points for a win</span>
      </div>
      <div className="hiw-score">
        <span className="hiw-pts">1</span>
        <span className="hiw-lbl">point for a draw</span>
      </div>
      <div className="hiw-score">
        <span className="hiw-pts">0</span>
        <span className="hiw-lbl">points for a loss</span>
      </div>
      <div className="hiw-score afr">
        <span className="hiw-pts">×2</span>
        <span className="hiw-lbl">your African team scores double</span>
      </div>
    </div>
  );
}
