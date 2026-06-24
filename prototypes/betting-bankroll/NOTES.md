# Prototype: betting bankroll model

**Throwaway.** Run: `npm run prototype:betting` (Node ≥23.6 strips the TS types natively).

## The question

Does the bankroll state model in `convex/betting.ts` *feel right* once you push real
betting sequences through it by hand? The model recomputes a player's bankroll on
every read from their bets + the matches table — nothing is stored. Four parts of it
look fine on paper but are easy to get wrong in sequence:

1. **Replacing a bet frees its old stake first.** `placeBet` computes `available` over
   *other* bets, so re-betting the same match doesn't double-count the held stake.
2. **A pending stake is held in the SCORE but withheld from AVAILABLE.** It only leaves
   `bankroll` once its match settles.
3. **`bankroll` and `available` are floored at 0** — a host lowering the pot, a re-synced
   result, or a buyer losing everything can push the raw sum negative.
4. **Bought coins lift `available` but are absent from the scored `bankroll`.** Buying
   never moves the leaderboard; only winning/losing with the coins does.

## What to drive

The seed has a lopsided group game (#1 France v Haiti), an even group game
(#2 Germany v Croatia), and a knockout (#3 Brazil v England, no draw). Try the
sequences the model is supposed to survive:

- `bet 1 home 30` then `bet 1 away 10` — does replacing free the first stake? (available
  should go back to 20, not stay at 0)
- `bet 1 home 30` then `bet 2 home 1` — second should be **rejected** (available is 0
  while the first is pending).
- `bet 1 home 30`, `finish 1 away` — settled loss; score drops to 0, not negative.
- `buy 20`, then watch: available rises by 20, **score is unchanged**. Lose it all and
  score floors at 0 — below a non-bettor who kept their 30.
- `bet 1 home 30`, `kick 1` — bet locks; can you still `cancel 1`? (no — closed)
- `pot 5` after staking 30 — host lowers the pot under an existing pending stake. Watch
  available floor at 0 and the "vs non-bettor" delta go red.
- `cap off` then `buy 5` — rejected. `cap unlimited` then `buy 999` — allowed.

## Verdict

_(fill in after driving it — what felt wrong, what surprised you, what to change in
convex/betting.ts. Then delete this prototype or fold the decision back into the code.)_
