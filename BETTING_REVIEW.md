# Verification & Risk Review — Per-Room Match Betting

**Reviewer:** senior-engineer pass against `BETTING_PRD.md`
**Date:** 2026-06-12
**Scope:** `convex/pool.ts`, `convex/betting.ts`, `convex/schema.ts`, `convex/results.ts`,
`convex/rooms.ts`, `src/LiveApp.tsx` (betting UI).

## Verdict

**The implementation is faithful to the PRD and ship-ready for v1.** Odds math matches
the spec's worked examples exactly, the derived-bankroll model is correct, the headline
invariant ("a player never drops below their pure draw score") holds on the leaderboard,
typecheck and production build are clean. The findings below are edge-case risks and
spec deviations, none of them blocking — but **R1** is worth a decision before launch.

## Post-review change — Mid-tournament betting (pot lock moved from kickoff → first bet)

**Why:** existing games were already in progress when betting shipped, and the PRD's "lock the pot
once the tournament kicks off" rule blocked them from ever enabling it. Re-examining the two stated
reasons for that lock: (1) *"block betting on known results"* is already enforced independently —
`bettableMatches`/`placeBet` only accept `SCHEDULED`/`TIMED` matches ([betting.ts isOpen](convex/betting.ts#L14)),
so only **upcoming** fixtures are ever bettable regardless of when betting is enabled; (2) *"freeze
the bankroll baseline once bets could be live"* is the real invariant, and its precise trigger is
**"a bet exists,"** not kickoff.

**Change:** `setPot` now locks the pot the moment the **first bet** is placed
([rooms.ts](convex/rooms.ts)) rather than at tournament kickoff. It stays freely editable in the
lobby or on a `done` room with no bets yet — which lets any in-progress game opt into betting
mid-tournament (players back the remaining fixtures). A new `potLocked({ code })` query drives the
host control's disabled/locked state so UI and server share one condition. `resetRoom` already wipes
bets, so a re-draw re-opens the pot.

**Safety:** strictly no new exploit — betting on known/in-progress results was already impossible,
re-baselining before the first bet is uniform across players, and the baseline freezes exactly when
it must. **Tuning note:** fewer matches remain mid-tournament, so a given pot swings less than over a
full tournament; hosts can raise the pot (control goes to 100) to keep it "co-equal." Typecheck +
build clean.

## What was verified (passing)

| Check | Result |
|---|---|
| `tsc --noEmit` (frontend + Convex) | ✅ clean (exit 0) |
| `npm run build` (`tsc && vite build`) | ✅ clean, bundles emitted |
| Odds — KO worked examples (Ger/Cro, Cro/Ger, Arg/USA) | ✅ ×1.79 / ×2.26 / ×1.06, tested against the real `matchOdds` export |
| Odds — group 3-way (Ger/Cro) | ✅ ×2.28 / ×4.18 / ×3.09 (H/D/A), matches PRD note |
| Group implied probs (`1/odds`) sum to 1 | ✅ within 1e-3 |
| KO exposes no DRAW; group exposes DRAW | ✅ |
| `fairOdds` clamps to `[1.05, 8]` | ✅ both bounds |
| `clampStartingPot` (max / floor-0 / default / rounding) | ✅ |
| Bankroll scenarios: win→50, loss→10, pending held, all-in-lose→0 | ✅ (re-derived from `computeBankroll`) |
| Identity is server-derived (`getAuthUserId`), never a client arg | ✅ in every query/mutation |
| Double-spend race | ✅ not possible — Convex mutations are serializable transactions; `available` is recomputed inside `placeBet` |
| `placeBet` "edit frees the replaced stake" accounting | ✅ `available` computed from `others` (excludes this match's bet) — [betting.ts:281-291](convex/betting.ts#L281-L291) |
| Lock rules (pot 0 / not `done` / kicked-off match / DRAW on KO / stake>available) | ✅ all enforced — [betting.ts:256-299](convex/betting.ts#L256-L299) |
| `setPot` host-only + `drawing`/kicked-off lock | ✅ — [rooms.ts setPot](convex/rooms.ts) |
| Cleanup of `bets` in `deleteRoom` / `resetRoom` | ✅ |
| Pot 0 (or undefined) ⇒ behaviour identical to pre-feature | ✅ `standings` short-circuits `bettingOn` |
| Visibility: queries only ever return the viewer's own picks | ✅ all scoped by `by_room_player` + `me._id` |

The standings clamp that enforces the headline invariant is correct:
[results.ts](convex/results.ts) folds `Math.max(0, bank.bankroll)` into `total`, so a cold
betting run contributes 0 and never drags the score below `drawTotal`.

---

## Risks & findings

### R1 — Bankroll can go negative in the betting panel (leaderboard is protected, the UI is not) — **Medium-low** — ✅ FIXED

**Resolution:** `computeBankroll` now floors both `bankroll` and `available` at 0
([betting.ts:70-72](convex/betting.ts#L70-L72)), and the redundant clamp in `standings` was
removed so all readers share one source of truth. Verified: pot-cut-then-lose and pot-cut-then-pending
both floor to 0 instead of −20; normal win/loss/pending paths unchanged. The optional `setPot`
guard (refuse lowering below outstanding stakes) was **not** added — the floor closes the visible
inconsistency, and the score invariant now holds unconditionally.

_Original finding:_

`computeBankroll` ([betting.ts:54-73](convex/betting.ts#L54-L73)) returns an **unclamped**
`bankroll`/`available`. `standings` floors it with `Math.max(0, …)` so the *leaderboard*
never goes below the draw score — but `myBankroll` and the Betting header
([LiveApp.tsx:1446-1465](src/LiveApp.tsx#L1446-L1465)) render the raw value, and `placeBet`
blocks all further bets once `available` is negative. Two reachable triggers:

1. **Pot lowered after bets exist (in-app, realistic).** Betting opens the moment a room is
   `done` + `startingPot > 0` — which is *before* kickoff. `setPot` is editable until kickoff
   and allows *changing* the pot, not just enabling it. If a player goes all-in (stake 30 on a
   `SCHEDULED` match) and the host then lowers the pot to 10, `computeBankroll(10, …)` yields
   `available = 10 − 30 = −20`. If that bet then loses, the panel shows `bankroll −20` while
   the leaderboard shows 0. The PRD's "lock at kickoff freezes the baseline" comes **too late**
   — bets are live from `done`, not from kickoff.
2. **Corrected result (the path §9 advertises as free).** Win a bet → re-stake the winnings →
   the first match's `winner` is re-synced to a loss. `settledNet` drops below what the second
   stake was sized against, pushing `bankroll` negative.

**Impact:** display inconsistency (panel shows negative, leaderboard shows 0) and a player
locked out of further betting. No data corruption; the headline invariant still holds.
**Recommendation (pick one):** (a) floor inside `computeBankroll` (`bankroll = Math.max(0, …)`)
so all readers agree; **and/or** (b) in `setPot`, refuse to lower the pot below the largest
per-player `pendingStakes` once any bet exists, or only allow enabling-from-0 / raising on a
`done` room. (a) is the cheap, consistent fix.

### R2 — `done`-room host pot control stays interactive after kickoff — **Low (UX)** — ✅ FIXED

**Resolution:** the host pot control now reads a `potLocked({ code })` query
([rooms.ts](convex/rooms.ts), [LiveApp.tsx:534](src/LiveApp.tsx#L534)) and, once the pot is locked,
disables the slider with a *"🔒 Locked"* note instead of letting the host change it and fail on
submit. Server gate and UI lock share the same condition so they can't drift. _(Originally gated
on tournament kickoff; superseded by the §"Mid-tournament betting" change below, which moved the
lock from kickoff to first-bet — the UI lock followed.)_ Typecheck + build clean.

_Original finding:_

The host's `PotControl` on a locked room ([LiveApp.tsx:1173-1189](src/LiveApp.tsx#L1173-L1189))
renders and accepts input regardless of tournament state. The server correctly rejects with
*"The tournament has kicked off — the betting pot is locked"*, but the client only learns this
on submit (shown via `err`). No client-side query of match kickoff state to disable/explain the
control up front. **Recommendation:** gate the control (or show a "locked" note) using the same
kicked-off signal the server uses. Cosmetic — no data risk.

### R3 — `standings` exposes per-player `pendingStakes` / `settledNet`, eroding the "private read" edge — **Low** — ✅ FIXED

**Resolution:** `standings` now derives the viewer via `getAuthUserId` and only returns
`pendingStakes`/`settledNet` on the viewer's own row; every other row reports them as 0
([results.ts](convex/results.ts)). `bankroll`/`total` stay public (the combined leaderboard). The
frontend already gated those fields behind `isMe` ([LiveApp.tsx:1374-1383](src/LiveApp.tsx#L1374-L1383)),
so no UI change. Note: the public `bankroll` still implies a rival's *settled* P&L
(`bankroll − startingPot`), but that becomes public via the leaderboard total anyway, and
pre-kickoff every bankroll equals `startingPot` — so the sensitive pre-kickoff posture leak
(`pendingStakes`, i.e. how much someone has committed) is now closed. Typecheck + build clean.

_Original finding:_

The private-read advantage (design decisions #8 and #14) depends on rivals **not** knowing your
betting posture until kickoff. `standings` returns `pendingStakes` and `settledNet` for **every**
player ([results.ts](convex/results.ts)), and the PRD only promised that *bankroll totals* are
public. Pre-kickoff, `settledNet` is 0 for everyone but `pendingStakes` reveals exactly how much
a rival has committed (e.g. all-in = high confidence) before any match locks. **Recommendation:**
expose only the combined public `bankroll`/`total` to other rows; keep `pendingStakes` /
`settledNet` to the viewer's own row.

### R4 — `bets.by_match` index is defined but unused — **Low (dead code)** — ✅ FIXED

**Resolution:** dropped the unused `by_match` index from the `bets` table
([schema.ts:102-103](convex/schema.ts#L102-L103)) — no code referenced it (confirmed by grep),
so it only cost write throughput on every bet insert/patch. It's a trivial one-line re-add if a
host "void match" tool (which would query bets by `matchExtId`) lands later. The next
`convex dev`/`deploy` drops the index, which is a non-destructive schema change. Typecheck +
build clean.

_Original finding:_

§5 specifies three indexes; `by_match` ([schema.ts:104](convex/schema.ts#L104)) is created but no
query or mutation uses it (all lookups go through `by_room` / `by_room_player`). Harmless beyond a
small per-write cost; it anticipates a future "void match" tool. **Recommendation:** keep it only
if that tool is on the roadmap, otherwise drop it to avoid an unused index.

### R5 — Other players' picks are *never* revealed, even post-kickoff — **Low (spec deviation)** — ✅ RESOLVED (intended)

**Decision:** keep picks **fully private** — no code change. Confirmed with the product owner that
never exposing another player's individual pick (only public bankroll totals) is the desired
behaviour; it's the strongest-privacy reading and simpler than a post-kickoff reveal. The PRD's
*"until the match has kicked off"* wording is superseded — there is no post-kickoff pick reveal,
by design. Treat this as the canonical spec going forward.

_Original finding:_

PRD §6 phrases the rule as picks being hidden *"until the match has kicked off"*, implying a
post-kickoff reveal. The implementation is stricter — no query returns another player's individual
pick at any point. This is arguably *better* for privacy, but if post-kickoff pick reveal was an
intended feature, it is missing. **Recommendation:** confirm intent; if reveal is wanted, add a
query that returns others' picks only for matches where `status` has left `SCHEDULED`/`TIMED`.

### R6 — Full `matches` table scan per read — **Very low (fine at WC scale)**

`bettableMatches`, `myBankroll`, `myBets`, and `standings` each call
`ctx.db.query("matches").collect()` on every reactive read. With ~104 WC matches this is
negligible; noting it only so it isn't mistaken for indexed access if the table ever grows.

### R7 — Abandoned / never-`FINISHED` match locks its stake forever — **None (documented)**

Per §9, an abandoned match leaves its stake `pending` indefinitely (held in `bankroll`, withheld
from `available`). Correctly implemented and explicitly accepted for v1; flagged here only so it's
a known, deliberate behaviour rather than a surprise.

---

## Notes

- The two items the implementer flagged (group 3-way vs 2-way pricing; leaving `/how-it-works`
  untouched) are both correct/expected, not regressions — confirmed against §4.
- The uncommitted turn-timer work (`resolveCurrentTurn`, `setTimer`, `resolveTimeout`,
  `armTimerPatch` in `rooms.ts`) is interleaved in the same working tree but is unrelated to
  betting. It typechecks and builds with the betting changes; review it separately before commit.
- Suggested commit split: betting (`pool.ts`, `betting.ts`, `schema.ts bets`/`startingPot`,
  `results.ts`, `createRoom`/`setPot`/cleanup, `LiveApp.tsx` betting UI) as one change; the
  turn-timer work as another.
