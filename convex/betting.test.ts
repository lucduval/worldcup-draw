import { describe, expect, test } from "vitest";
import { computeBankroll } from "./betting";
import type { BetPick } from "./pool";

// Helpers to build the inputs computeBankroll reads.
type Bet = { matchExtId: number; pick: BetPick; stake: number; odds: number };
const finished = (winner: BetPick) =>
  new Map([[1, { status: "FINISHED" as const, winner }]]);
const open = () => new Map([[1, { status: "SCHEDULED" as const }]]);
const bet = (pick: BetPick, stake: number, odds: number): Bet => ({
  matchExtId: 1,
  pick,
  stake,
  odds,
});

// The core seam: scored `bankroll` excludes purchased coins; `available`
// includes them. Floored at 0 everywhere. Mirrors the bankroll scenarios the
// base betting feature reasons about, extended for the buy-coins layer.
describe("computeBankroll", () => {
  test("(a) scored bankroll ignores purchased coins; (b) available includes them", () => {
    const b = computeBankroll(30, 20, [], new Map());
    expect(b.bankroll).toBe(30); // scored: free pot only
    expect(b.purchasedCoins).toBe(20);
    expect(b.available).toBe(50); // stakeable: free pot + purchased
  });

  test("(b) available subtracts pending stakes but bankroll holds them", () => {
    const b = computeBankroll(30, 20, [bet("HOME", 40, 2)], open());
    expect(b.pendingStakes).toBe(40);
    expect(b.bankroll).toBe(30); // pending stake still counted in scored
    expect(b.available).toBe(10); // 30 + 20 − 40
  });

  test("(c) winnings on a bet only affordable via purchased coins raise the scored bankroll above the free pot", () => {
    // Free pot 10, bought 40 → could stake 40. Wins at ×2.
    const b = computeBankroll(10, 40, [bet("HOME", 40, 2)], finished("HOME"));
    expect(b.settledNet).toBe(40); // round(40×2) − 40
    expect(b.bankroll).toBe(50); // max(0, 10 + 40) — above the free pot of 10
    expect(b.available).toBe(90); // 10 + 40 + 40 − 0
  });

  test("(d) losing bought coins drops the scored bankroll below the free pot, floored at 0", () => {
    const b = computeBankroll(10, 40, [bet("HOME", 40, 2)], finished("AWAY"));
    expect(b.settledNet).toBe(-40);
    expect(b.bankroll).toBe(0); // max(0, 10 − 40) — below free pot, never negative
    expect(b.available).toBe(10); // max(0, 10 + 40 − 40) — the unstaked free pot remains
  });

  test("(d cont.) a non-buyer keeps the free pot the buyer dropped below", () => {
    // Same losing stake but funded only by the free pot variant: buyer can fall
    // below a player who never bought and sat on their pot.
    const buyer = computeBankroll(30, 0, [bet("HOME", 30, 2)], finished("AWAY"));
    const sitter = computeBankroll(30, 0, [], new Map());
    expect(buyer.bankroll).toBe(0);
    expect(sitter.bankroll).toBe(30);
  });

  test("(f) a knockout won on penalties pays the winning side even though normal time was level", () => {
    // The feed records the full-time goals as level (1–1) but sets `winner` to
    // the shootout victor. Settlement keys off `winner` only — it never compares
    // goals — so a HOME bet wins and an AWAY bet loses on a penalty result.
    const won = computeBankroll(0, 10, [bet("HOME", 10, 2)], finished("HOME"));
    expect(won.settledNet).toBe(10); // round(10×2) − 10
    const lost = computeBankroll(0, 10, [bet("AWAY", 10, 2)], finished("HOME"));
    expect(lost.settledNet).toBe(-10);
  });

  test("(e) available never goes negative even when a re-synced loss exceeds the raw sum", () => {
    // settledNet −10 (lost a 10 stake) plus a 5 pending stake against a free pot
    // of 10 and no purchases ⇒ raw 10 − 10 − 5 = −5, floored to 0.
    const matches = new Map<number, { status: string; winner?: BetPick }>([
      [1, { status: "FINISHED", winner: "AWAY" }],
      [2, { status: "SCHEDULED" }],
    ]);
    const bets: Bet[] = [
      { matchExtId: 1, pick: "HOME", stake: 10, odds: 2 },
      { matchExtId: 2, pick: "HOME", stake: 5, odds: 2 },
    ];
    const b = computeBankroll(10, 0, bets, matches);
    expect(b.available).toBe(0);
    expect(b.bankroll).toBe(0);
  });
});
