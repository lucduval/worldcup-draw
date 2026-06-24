// ─────────────────────────────────────────────────────────────────────────────
// PROTOTYPE — throwaway. Not imported by production. Safe to delete.
//
// QUESTION THIS ANSWERS (see NOTES.md):
//   Does the bankroll state model in convex/betting.ts *feel right* once you push
//   real betting sequences through it by hand? Specifically the four things that
//   look fine on paper but are easy to get wrong in sequence:
//     1. Replacing a bet frees its old stake before the available check.
//     2. A pending stake stays counted in the scored `bankroll` but is withheld
//        from `available` until its match settles.
//     3. `bankroll` and `available` are both floored at 0 (host lowers pot, a
//        result re-syncs, a buyer loses everything).
//     4. Bought coins lift `available` but are ABSENT from the scored `bankroll`,
//        so buying never moves the leaderboard — only winning/losing with them does.
//
// The pure odds/cap helpers are imported from the real module (convex/pool.ts) so
// the prototype prices bets exactly as production does. `computeBankroll` is the
// heart of the question, so it is MIRRORED here verbatim from convex/betting.ts —
// keep the two in sync; if the prototype teaches us to change the model, change it
// in convex/betting.ts and re-copy.
// ─────────────────────────────────────────────────────────────────────────────

import {
  RANK_BY_NAME,
  FLAG_BY_NAME_FALLBACK,
  matchOdds,
  purchaseCapOf,
  remainingAllowance,
  validatePurchase,
  type BetPick,
  type PurchaseCap,
} from "./poolShim.ts";

// ── Mirror of convex/betting.ts ────────────────────────────────────────────────
export type BetPickT = BetPick;

export type Match = {
  extId: number;
  homeTeam: string;
  awayTeam: string;
  stage: string; // "GROUP_STAGE" | anything else (knockout)
  status: string; // SCHEDULED | TIMED | IN_PLAY | FINISHED
  winner?: BetPick;
};

export type Bet = {
  matchExtId: number;
  pick: BetPick;
  stake: number;
  odds: number;
  placedAt: number;
};

export type Bankroll = {
  startingPot: number;
  purchasedCoins: number;
  bankroll: number;
  available: number;
  pendingStakes: number;
  settledNet: number;
};

export function isOpen(status: string): boolean {
  return status === "SCHEDULED" || status === "TIMED";
}
export function isFinished(m: { status: string; winner?: BetPick }): boolean {
  return m.status === "FINISHED" && m.winner != null;
}
export function isKnockoutStage(stage: string): boolean {
  return stage !== "GROUP_STAGE";
}

// VERBATIM mirror of convex/betting.ts → computeBankroll.
export function computeBankroll(
  startingPot: number,
  purchasedCoins: number,
  bets: { matchExtId: number; pick: BetPick; stake: number; odds: number }[],
  matchByExtId: Map<number, { status: string; winner?: BetPick }>,
): Bankroll {
  let settledNet = 0;
  let pendingStakes = 0;
  for (const b of bets) {
    const m = matchByExtId.get(b.matchExtId);
    if (m && isFinished(m)) {
      settledNet +=
        b.pick === m.winner ? Math.round(b.stake * b.odds) - b.stake : -b.stake;
    } else {
      pendingStakes += b.stake;
    }
  }
  const bankroll = Math.max(0, startingPot + settledNet);
  const available = Math.max(
    0,
    startingPot + purchasedCoins + settledNet - pendingStakes,
  );
  return {
    startingPot,
    purchasedCoins,
    bankroll,
    available,
    pendingStakes,
    settledNet,
  };
}

// ── Prototype state + a pure reducer over it ───────────────────────────────────
// The TUI shell calls `dispatch`; nothing flows the other way. Every action that
// production would reject throws an Error with the same message production uses,
// so the prototype surfaces the real guardrails.

export type State = {
  startingPot: number;
  purchasedCoins: number;
  cap: PurchaseCap;
  matches: Match[];
  bets: Bet[];
  clock: number; // monotonic stand-in for Date.now() (placedAt ordering)
};

export type Action =
  | { t: "bet"; extId: number; pick: BetPick; stake: number }
  | { t: "cancel"; extId: number }
  | { t: "kick"; extId: number } // SCHEDULED/TIMED → IN_PLAY (locks betting)
  | { t: "finish"; extId: number; winner: BetPick }
  | { t: "reopen"; extId: number } // back to SCHEDULED (re-sync / undo)
  | { t: "buy"; amount: number }
  | { t: "pot"; amount: number } // host changes the starting pot mid-game
  | { t: "cap"; spec: "off" | "unlimited" | number };

function matchMap(matches: Match[]): Map<number, Match> {
  return new Map(matches.map((m) => [m.extId, m]));
}

function oddsFor(m: Match, pick: BetPick): number {
  const homeRank = RANK_BY_NAME[m.homeTeam];
  const awayRank = RANK_BY_NAME[m.awayTeam];
  if (homeRank === undefined || awayRank === undefined)
    throw new Error("This match can't be priced.");
  const odds = matchOdds(homeRank, awayRank, isKnockoutStage(m.stage));
  const chosen = odds[pick];
  if (chosen === undefined) throw new Error("That outcome isn't available.");
  return chosen;
}

// Mirrors placeBet's available check: available is computed over OTHER bets
// (the bet being replaced has its stake freed first).
export function dispatch(s: State, a: Action): State {
  const byId = matchMap(s.matches);
  switch (a.t) {
    case "bet": {
      const m = byId.get(a.extId);
      if (!m) throw new Error("Match not found.");
      if (!isOpen(m.status)) throw new Error("Betting is closed for this match.");
      if (isKnockoutStage(m.stage) && a.pick === "DRAW")
        throw new Error("Knockout matches can't end in a draw.");
      if (!Number.isInteger(a.stake) || a.stake < 1)
        throw new Error("Stake must be a whole number of at least 1.");
      const others = s.bets.filter((b) => b.matchExtId !== a.extId);
      const { available } = computeBankroll(
        s.startingPot,
        s.purchasedCoins,
        others,
        byId,
      );
      if (a.stake > available)
        throw new Error(`Stake exceeds your available bankroll (${available}).`);
      const odds = oddsFor(m, a.pick);
      const placedAt = s.clock + 1;
      const bet: Bet = {
        matchExtId: a.extId,
        pick: a.pick,
        stake: a.stake,
        odds,
        placedAt,
      };
      return {
        ...s,
        clock: placedAt,
        bets: [...others, bet],
      };
    }
    case "cancel": {
      const m = byId.get(a.extId);
      if (m && !isOpen(m.status))
        throw new Error("Betting is closed for this match.");
      return { ...s, bets: s.bets.filter((b) => b.matchExtId !== a.extId) };
    }
    case "kick":
      return patchMatch(s, a.extId, (m) => ({ ...m, status: "IN_PLAY" }));
    case "finish":
      return patchMatch(s, a.extId, (m) => {
        if (isKnockoutStage(m.stage) && a.winner === "DRAW")
          throw new Error("Knockout matches can't end in a draw.");
        return { ...m, status: "FINISHED", winner: a.winner };
      });
    case "reopen":
      return patchMatch(s, a.extId, (m) => ({
        ...m,
        status: "SCHEDULED",
        winner: undefined,
      }));
    case "buy": {
      const check = validatePurchase(s.cap, s.purchasedCoins, a.amount);
      if (!check.ok) throw new Error(check.error);
      return { ...s, purchasedCoins: s.purchasedCoins + a.amount };
    }
    case "pot": {
      if (!Number.isFinite(a.amount) || a.amount < 0)
        throw new Error("Pot must be a non-negative number.");
      return { ...s, startingPot: Math.round(a.amount) };
    }
    case "cap": {
      const cap: PurchaseCap =
        a.spec === "off"
          ? { kind: "off" }
          : a.spec === "unlimited"
            ? { kind: "unlimited" }
            : { kind: "limited", cap: Math.floor(a.spec) };
      return { ...s, cap };
    }
  }
}

function patchMatch(s: State, extId: number, f: (m: Match) => Match): State {
  let hit = false;
  const matches = s.matches.map((m) => {
    if (m.extId !== extId) return m;
    hit = true;
    return f(m);
  });
  if (!hit) throw new Error("Match not found.");
  return { ...s, matches };
}

// ── Derived views the TUI renders (all pure) ───────────────────────────────────
export function bankrollOf(s: State): Bankroll {
  return computeBankroll(
    s.startingPot,
    s.purchasedCoins,
    s.bets,
    matchMap(s.matches),
  );
}

export function remaining(s: State): number | null {
  return remainingAllowance(s.cap, s.purchasedCoins);
}

export function capLabel(cap: PurchaseCap): string {
  return cap.kind === "off"
    ? "off"
    : cap.kind === "unlimited"
      ? "unlimited"
      : `limited (${cap.cap})`;
}

export function flagOf(team: string): string {
  return FLAG_BY_NAME_FALLBACK[team] ?? "🏳️";
}

export function oddsLine(m: Match): { HOME: number; AWAY: number; DRAW?: number } {
  const homeRank = RANK_BY_NAME[m.homeTeam];
  const awayRank = RANK_BY_NAME[m.awayTeam];
  return matchOdds(homeRank, awayRank, isKnockoutStage(m.stage));
}
