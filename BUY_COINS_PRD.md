# PRD: Buy More Coins (betting re-buy)

**Status:** Approved design (grill-me), 2026-06-22. Not yet implemented.
**Audience:** an engineer implementing this in a fresh context window.
**Builds on:** `BETTING_PRD.md` (the per-room betting layer). Read that first for
the bankroll/standings model this extends.

> **Before writing any Convex code, read `convex/_generated/ai/guidelines.md`**
> (per the repo `CLAUDE.md`). It overrides general Convex knowledge.

---

## Problem Statement

A player who bets badly early in the tournament burns through their free
**starting pot** and is left with little or nothing to stake on the remaining
fixtures. They're effectively out of the betting game while matches are still
being played, with no way back in. Separately, the friend group settles a real
cash kitty offline, but the app's displayed **prize pot** is fixed at
`entry fee × players` and can't reflect anyone putting more money in.

## Solution

Let a player **buy more coins** mid-tournament as a real-money re-buy. Coins are
bought 1-for-1 with Rand (1 coin = R1); the cash is settled offline on the
honour system, the app only records it. Bought coins top up the player's
**available** betting balance so they can keep staking, and they grow the
tracked **prize pot** by the same amount. Crucially, buying coins does **not**
move the player's leaderboard score — only the wins and losses they make betting
those coins do. The free starting pot the host sets remains the fair, equal
baseline that folds into everyone's score.

The host controls whether re-buys are allowed and how large they can get via a
single new setup knob (Off / a number / Unlimited). Buying is self-serve, gated
behind a short, light-hearted confirmation that spells out the real Rand owed.

## User Stories

1. As a player who lost my starting coins early, I want to buy more coins, so that I can keep betting on the remaining fixtures.
2. As a player, I want bought coins to add to my available balance immediately, so that I can place a bet right after buying.
3. As a player, I want the coins I buy to NOT inflate my leaderboard score, so that the standings stay about how I draw and bet, not how much cash I throw in.
4. As a player, I want my winning bets funded by bought coins to raise my score, so that taking the re-buy risk can still pay off on the leaderboard.
5. As a player, I want my losing bets funded by bought coins to lower my score (down to a floor of zero), so that re-buying and losing has real stakes.
6. As a player, I want to buy coins at any point while betting is open, including after I've already placed bets, so that a re-buy works the way a re-buy should.
7. As a player, I want to buy any whole number of coins up to my remaining allowance, so that I can top up exactly as much as I want.
8. As a player, I want quick-pick chips (e.g. +10 / +25 / +50), so that I can top up fast without typing.
9. As a player, I want a clear confirmation before buying that tells me exactly how many Rand I'll owe, so that I never buy real-money coins by accident.
10. As a player, I want that confirmation to be short and light-hearted, so that it warns me without feeling like a legal disclaimer.
11. As a player, I want to see two distinct numbers — what I can stake (available) and what counts toward my score — so that I'm not confused when they diverge after buying.
12. As a player, I want a breakdown of my balance (free pot, purchased, winnings/losses, counts-toward-score), so that I understand where my numbers come from.
13. As a player, I want to know my remaining purchase allowance, so that I know how much more I'm allowed to buy.
14. As a player who has hit the purchase cap, I want the buy control to clearly show I can't buy more, so that I'm not confused by a failing action.
15. As any member, I want to see the prize pot grow when someone buys coins, so that the displayed pot reflects the real cash now in play.
16. As any member, I want to see who bought how many coins and the Rand they owe, so that we can settle the cash up correctly offline.
17. As a host, I want to choose whether coin-buying is allowed in my game, so that I can run a pure no-re-buy game if I prefer.
18. As a host, I want to set a per-player purchase cap (a number or unlimited), so that I can bound how much real money any one person can pour in.
19. As a host, I want coin-buying to default to Off, so that my game never silently gains real-money mechanics I didn't ask for.
20. As a host, I want the purchase cap to be independent of the free starting pot, so that every player gets the same re-buy allowance regardless of the free baseline I chose.
21. As a host, I want to adjust the cap while the game is running, so that I can loosen or tighten re-buys as the tournament unfolds.
22. As a host, I want to be prevented from setting the cap below what someone has already bought, so that the cap can never retroactively invalidate a purchase.
23. As a player, I want buying to be unavailable when betting is off in the room, so that I'm never asked to pay for coins I can't use.
24. As a player, I want my purchases to be final (no refunds in-app), so that the recorded coins always match the cash already owed.
25. As a player in a game that gets re-drawn, I want my purchased coins and their pot contribution wiped along with the bets, so that I don't owe cash for a game that was thrown away.
26. As a mobile player, I want the buy control, chips, input, and confirmation to be fully usable on a small screen, so that I can re-buy from my phone during a match.
27. As a player, I want the buy control to sit next to my bankroll on the betting screen, so that I top up exactly where I feel myself running low.

## Implementation Decisions

### Domain terms (use throughout)
- **Free starting pot** — the host-set, equal-for-all coins baseline (`startingPot`). Unchanged: still folds into the score, still locks once the first bet exists.
- **Purchased coins** — per-player, cumulative coins a player has bought. New.
- **Scored bankroll** — what folds into the leaderboard. Excludes purchased coins.
- **Available** — what a player can still stake. Includes purchased coins.
- **Prize pot** — the real-money kitty the app displays. Grows with purchases.
- **Re-buy** — the act of buying more coins mid-tournament.

### The math (the core decision)
Purchases are betting fuel, never score. Concretely, per player:

- **Scored bankroll** = `max(0, startingPot + settledNet)` — *unchanged from
  today*; purchased coins are deliberately absent. Because of this, the
  standings computation that reads `bankroll` needs **no change**.
- **Available to stake** = `max(0, startingPot + purchasedCoins + settledNet − pendingStakes)`.
- `settledNet` and `pendingStakes` keep their current definitions (over all the
  player's bets, including those funded by purchased coins).
- Floor at 0 everywhere; a player can never go negative or "owe" leaderboard
  points. Buying coins and losing them all can therefore drop a player's scored
  bankroll *below* a non-buyer's, down to 0.

### Single primary seam: `computeBankroll`
Extend the existing pure function (currently
`computeBankroll(startingPot, bets, matchByExtId)`) to take `purchasedCoins`:

- New signature shape: `computeBankroll(startingPot, purchasedCoins, bets, matchByExtId)`.
- The returned `Bankroll` gains a `purchasedCoins` field; `available` is computed
  including it; `bankroll` (scored) continues to exclude it.
- Every reader already flows through this function — `placeBet` (available
  check), `myBankroll`, and `standings` — so the invariants live in one place.
  `standings` reads `bankroll` (scored) and is unaffected by the new term.

### Cap helper (second pure seam)
Add a pure helper in `pool.ts` alongside `clampStartingPot`, encoding the cap
rule: given a requested amount, the player's already-purchased total, and the
room cap (Off / a number / Unlimited), return the allowed purchase (or a
validation result). Cumulative purchased coins may never exceed a numeric cap;
Unlimited bypasses the ceiling; Off forbids buying entirely. Whole numbers ≥ 1
only.

### Schema changes
- `rooms`: add the host purchase-cap setting. Represent the three states without
  ambiguity — e.g. an optional numeric `purchaseCap` where `undefined`/absent =
  **Off** (the default for all existing and new rooms), a positive number = that
  cap, and a dedicated sentinel/flag for **Unlimited** (e.g. a separate
  `purchaseUnlimited` boolean, or a documented sentinel value — implementer's
  choice, but it must be unambiguous and default to Off).
- `players`: add `purchasedCoins: optional(number)` — cumulative coins bought by
  this seat (absent ⇒ 0).

### New mutation: `buyCoins`
- Args: room `code`, `amount` (whole number ≥ 1).
- Server-derives identity and seat (mirror `placeBet`).
- Refuses unless: room is `done`, betting is on (`startingPot > 0`), and the cap
  is not Off.
- Validates the requested amount against the cap via the pool helper
  (cumulative purchased + amount ≤ cap, unless Unlimited).
- On success: `players.purchasedCoins += amount`. Irreversible — there is no
  un-buy / refund mutation.

### Host cap mutation
- The host sets/edits the cap (Off / number / Unlimited). Editable any time the
  room is not mid-draw (unlike the free pot, the cap is NOT locked by the
  existence of bets). Refused if a numeric cap would be set below the largest
  amount any single player has already purchased.
- Surface this control next to the existing free-pot control in setup.

### Prize pot
- The displayed pot becomes `entryFee × players + Σ purchasedCoins` (1 coin =
  R1). It is public to all room members and shown both in the lobby and on the
  betting screen (it now changes during the tournament). Today's pot is computed
  live in the client (`LiveApp.tsx`); the purchased-coins sum must feed the same
  derived figure (via an existing or new query — purchased totals are already
  needed for the ledger below).

### Purchase ledger (visibility)
- Expose, to all room members, a per-player list of purchased coins ("X bought N
  coins · owes RN"). This is intentionally fully public (unlike *bets*, which
  keep their hidden/live/public visibility modes — purchases are contributions,
  not strategy) and doubles as the offline settle-up sheet.

### Re-draw lifecycle
- The existing re-draw path that wipes bets must also zero every player's
  `purchasedCoins`, removing their contribution from the pot. The free starting
  pot stays as configured.

### Client / UX
- **Bankroll panel:** show **Available** as the primary number, with a smaller
  breakdown line: free pot, purchased, winnings/losses, and "counts toward
  score: N" (the scored bankroll).
- **Buy control:** free whole-number input + quick-pick chips (+10 / +25 / +50),
  next to the bankroll on the betting screen. Disabled/hidden when buying is
  unavailable (betting off, or cap Off, or allowance exhausted); show remaining
  allowance.
- **Confirmation dialog** (required before any purchase), copy approved:

  > 🎲 **{N} coins = R{N}** into the pot. Real money, you sort it out offline.
  > No take-backs, and coins don't boost your score, only winning bets do.
  > **[Buy {N}]   [Nah]**

- **Mobile is a first-class constraint.** Follow the patterns already landed in
  recent commits: no input auto-zoom, controls stack full-width on narrow
  screens, tap targets ≥ 44px, and the confirmation renders as a
  bottom-anchored sheet that fits without scrolling.

## Testing Decisions

A good test here exercises **external behavior** — the bankroll numbers a player
would see and the purchase rules they'd hit — not internal wiring. Tests target
the two pure seams, which is where all the logic lives:

- **`computeBankroll`** (extended): given a starting pot, purchased coins, a set
  of bets, and match outcomes, assert that (a) scored `bankroll` ignores
  purchased coins, (b) `available` includes them minus pending stakes, (c)
  winnings from bets funded by purchased coins raise scored bankroll, (d) losing
  bought coins can drop scored bankroll below the free pot, floored at 0, and (e)
  `available` never goes negative. These mirror the bankroll scenarios the base
  betting feature already reasons about in `BETTING_PRD.md`.
- **Cap helper** (`pool.ts`): assert Off forbids all purchases, a numeric cap
  allows cumulative buys up to but not past the ceiling, Unlimited allows any
  whole amount, and non-whole / `< 1` amounts are rejected. Prior art:
  `clampStartingPot` is the same shape of pure clamp/validation helper.

**Note on test infrastructure:** the repo currently has **no test runner or test
files**. Standing up a runner (e.g. Vitest) is a prerequisite if these are to be
automated; until then the seams are at minimum manually verifiable and written
to be trivially unit-testable. Flag this to the maintainer before assuming CI
coverage.

## Out of Scope

- Any in-app payment/charging. Cash is settled offline; the app only records.
- Refunds, partial refunds, or un-buying coins.
- Buying coins for *another* player, or host-granted coins (host is not a banker
  in this design — buying is self-serve only).
- Host approval / pending-request flow for purchases (rejected in design in
  favour of self-serve honour system).
- Letting purchased coins fold into the leaderboard score (explicitly rejected —
  that was the pay-to-win alternative).
- Changing bet visibility behaviour; purchase visibility is always public and
  independent of the bet-visibility modes.
- Cross-room or persistent (cross-game) coin balances.

## Further Notes

- The design's safety hinges on the Q3 decision: because purchases never touch
  the scored baseline, allowing mid-tournament buys (after bets exist) does
  **not** retroactively shift anyone's leaderboard position — only the buyer's
  own future stake capacity changes. This is why the free-pot lock can stay as-is
  while purchasing is always open.
- 1 coin = R1 is chosen to align with the existing `ENTRY_FEE` default of R100
  and `STARTING_POT_MAX` of 100, so "I bought 30 coins" reads directly as "I owe
  R30."
- The cap limits *purchased* coins on top of the free pot (not total bankroll),
  so a free pot of 30 with a cap of 100 yields a max stake capacity of 130 and a
  max of R100 owed.
