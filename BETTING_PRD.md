# PRD: Per-Room Match Betting

**Status:** Approved design, not yet implemented.
**Author of spec:** design conversation (grill-me), 2026-06-12.
**Audience:** an engineer implementing this in a fresh context window. Everything
needed is in this document.

> **Before writing any Convex code, read `convex/_generated/ai/guidelines.md`**
> (per the repo `CLAUDE.md`). It overrides general Convex knowledge.

---

## 1. Goal

Add a simple betting layer to the existing World Cup draw game. Players bet on
real World Cup match outcomes; winnings/losses adjust a per-room **bankroll**
that folds into their existing room score. Betting is **co-equal** with the
draw — a hot or cold betting run can overturn the draw result — but never drags
a player below their pure draw score.

Non-goals (v1): live odds feed, parlays/accumulators, scorelines, player-vs-
player side bets, cross-room bankrolls, cashing out before a match resolves.

---

## 2. How the existing app works (context for the implementer)

- **Backend:** Convex. Key files: `convex/schema.ts`, `convex/rooms.ts`,
  `convex/results.ts`, `convex/pool.ts`, `convex/crons.ts`.
- **Scoring is never stored — it is *derived*.** `results.standings`
  (`convex/results.ts:324`) recomputes every player's total live on each read by
  scanning the shared `matches` table: 3 pts/win, 1/draw, 0/loss for each owned
  team, and the player's African bonus team scores **double**. This betting
  feature MUST follow the same derived pattern (see §6).
- **Matches** (`matches` table) are synced from football-data.org by
  `results.syncResults` (an `internalAction` on a cron, `convex/crons.ts`).
  Fields: `extId` (football-data id, unique, indexed `by_ext`), `stage`
  (`GROUP_STAGE`, `LAST_16`/`ROUND_OF_16`, `QUARTER_FINALS`, `SEMI_FINALS`,
  `THIRD_PLACE`, `FINAL`), `status` (`SCHEDULED`, `TIMED`, `IN_PLAY`, `PAUSED`,
  `FINISHED`), `homeTeam`, `awayTeam` (canonicalised to POOL names via
  `canonicalTeam`), `homeGoals`, `awayGoals`, `winner` (`HOME`|`AWAY`|`DRAW`,
  set only when finished), `utcDate`.
- **Team ranking** lives in `convex/pool.ts`: `POOL` is a 48-team array whose
  index IS the FIFA rank (0 = best). `RANK_BY_NAME[name]` → rank index. This is
  the basis for odds. `ENTRY_FEE = 100` and the `entryFee` room field are the
  pattern to mirror for the host-set pot.
- **Rooms** (`rooms` table, `convex/rooms.ts`): `status` is `lobby` →
  `drawing` → `done`. Host-only lobby settings use the `setMode` pattern
  (`convex/rooms.ts:452`) — refuse the change once `status !== "lobby"`.
  `createRoom` (`convex/rooms.ts:390`) already accepts `entryFee` and `mode`.
- **Frontend:** React + react-router. `src/App.tsx` holds top-level routes
  (`/games/:code`, `/standings`, `/fixtures`, `/results`, …). The in-room view
  is `src/LiveApp.tsx` (large). After the draw locks (`done`), the room renders
  a vertical stack of `CollapsibleSection`s: **Standings** (the leaderboard,
  `src/LiveApp.tsx:1188`), **The Pots**, **Left out**, **Fixtures**. The
  create/join form with `buyIn`/`mode`/`gameName` state is around
  `src/LiveApp.tsx:225–410`. `Fixtures` (`src/FixturesView.tsx`) is **shared**
  between the standalone `/fixtures` page and the in-room view — do NOT entangle
  room-specific betting state into it.

---

## 3. Locked design decisions (with rationale)

| # | Decision | Choice | Why |
|---|----------|--------|-----|
| 1 | What you bet on | Individual real **match outcomes** | Only thing that auto-resolves off data already synced. |
| 2 | Risk model | **Bankroll** (model C): finite per-room pot, stake & lose | Real risk + scarcity, bounded so it never eats the draw score. |
| 3 | Outcome granularity | **Result only** (1X2) | Single tap; resolves off `matches.winner`. |
| 4 | Odds | **Continuous, odds-weighted**, snapshotted at placement | Prices each game on merit; no band cliff-edges; future live-odds swap is drop-in. |
| 6 | House edge | **Fair odds, `1/p`** (EV-neutral) | Betting is a real opportunity to climb, not a slow tax. Risk = variance + private read. |
| 7 | Settlement timing | **Live**, single **combined leaderboard** | `standings` is already reactive/derived — settling live is essentially free. |
| 8 | Edit/cancel | **Free until kickoff**; locked once `IN_PLAY`/`FINISHED` | Friendly; no exploit because rank-based odds don't drift. |
| 9 | Magnitude | **Co-equal** with the draw | User intent: betting must matter and carry real risk. |
| 10 | Host control | `startingPot` default **30**, range **0–100**, **0 = off**, editable in **lobby OR on a `done` room until the tournament kicks off**, with live impact label | Mirrors `entryFee`/`mode`; pot is the on/off switch. Existing/already-drawn games can opt in before the first WC match. |
| 11 | Architecture | **Derived** bankroll (store only bets) | Matches the whole app; corrected results auto-re-settle; no drift. |
| 12 | Staking | Whole numbers, **min 1, all-in allowed**, pending stakes held aside, **one bet/match** (edit replaces) | Variance is the point; floored at 0; no double-spend. |
| 13 | Draw outcome | 3-way (H/D/A) for group; **2-way (H/A) for knockouts** | Knockouts never end DRAW (penalty result counts). |
| 14 | UI | Dedicated **"Betting" CollapsibleSection** + Standings bankroll chip; **picks hidden until kickoff**, totals public | Keeps shared `Fixtures` clean; preserves private-read edge. |

**Mental model to preserve in copy/UI:** the pot is a **starting stack the
player is given**. Sit on it → keep +30. Gamble it away → drop to +0 (never
below the pure draw score). Grow it → climb. Keeping it safe is a valid
strategy; the odds make "always back favourites" pointless (see §4).

---

## 4. The odds model (exact math)

Put these helpers + constants in `convex/pool.ts` (shared by backend and client,
like the rest of that file). `gap = rank[team] - rank[opponent]` (positive ⇒
the picked team is the underdog).

```ts
// Tunable constants (pool.ts)
export const STARTING_POT_DEFAULT = 30;
export const STARTING_POT_MAX = 100;
export const ODDS_MIN = 1.05;   // floor: heavy favourite still returns a sliver
export const ODDS_MAX = 8;      // cap: keep longshots sane
export const DRAW_BASE = 0.27;  // peak draw probability for an even group match

// Win-share of `team` vs `opp` from the rank gap (Elo-style logistic).
function winShare(teamRank: number, oppRank: number): number {
  return 1 / (1 + Math.pow(10, (teamRank - oppRank) / 10));
}

// Fair decimal odds for a probability, clamped.
function fairOdds(p: number): number {
  return Math.max(ODDS_MIN, Math.min(ODDS_MAX, 1 / p));
}

// 1X2 probabilities for a GROUP match (home perspective), summing to 1.
function groupProbs(homeRank: number, awayRank: number) {
  const pa = winShare(homeRank, awayRank);          // home "better share"
  let pDraw = DRAW_BASE * (1 - Math.abs(2 * pa - 1)); // peaks when even
  let pHome = Math.max(0, pa - pDraw / 2);
  let pAway = Math.max(0, (1 - pa) - pDraw / 2);
  const s = pHome + pAway + pDraw;
  return { pHome: pHome / s, pAway: pAway / s, pDraw: pDraw / s };
}

// 2-way probabilities for a KNOCKOUT match (no draw).
function koProbs(homeRank: number, awayRank: number) {
  const pHome = winShare(homeRank, awayRank);
  return { pHome, pAway: 1 - pHome };
}
```

**Pricing a match:** group matches expose odds for `HOME`, `DRAW`, `AWAY`
(= `fairOdds(pHome|pDraw|pAway)`); knockout matches expose only `HOME`/`AWAY`.
Detect knockout via `stage !== "GROUP_STAGE"`.

**A match is bettable only if both teams resolve to a POOL rank** (i.e.
`RANK_BY_NAME[homeTeam]` and `[awayTeam]` are both defined). If either is
`undefined` (name-mapping miss), the match is **not bettable** — omit it.

**Worked examples (verified by simulation, base stake 50):**
- Germany vs Croatia (gap −1, 55.7%): odds **×1.79**; win returns 89.7 (net
  +39.7), lose −50; EV = 0.
- Croatia vs Germany (44.3%): odds **×2.26**; win +62.9; EV = 0.
- Argentina vs USA (94.1% lock): odds **×1.06**; win returns only 53.2 (net
  +3.2); EV = 0 — risking 50 to make 3 is why favourite-hammering is pointless.

---

## 5. Data model changes (`convex/schema.ts`)

**Add field to `rooms`:**
```ts
// Per-player starting betting bankroll (whole Rand-style points), host-set in
// the lobby. 0 disables betting for the room. Optional so pre-existing rooms
// default to "betting off" (treat undefined as 0 at read time, OR default 30 —
// see note). Locked once status leaves "lobby".
startingPot: v.optional(v.number()),
```
> Decision for existing rooms: treat `undefined` as **betting off (0)** so the
> feature never silently appears in already-running games. New rooms default to
> `STARTING_POT_DEFAULT` (30) in `createRoom`. **The host of an existing /
> already-drawn game CAN opt in** by setting a pot via `setPot`, but only before
> the tournament kicks off (see §6 `setPot` and §8).

**New `bets` table:**
```ts
bets: defineTable({
  roomId: v.id("rooms"),
  playerId: v.id("players"),
  userId: v.id("users"),        // denormalised for ownership checks
  matchExtId: v.number(),       // -> matches.extId
  pick: v.union(v.literal("HOME"), v.literal("DRAW"), v.literal("AWAY")),
  stake: v.number(),            // whole number, >= 1
  odds: v.number(),             // decimal odds snapshotted at placement
  placedAt: v.number(),
})
  .index("by_room", ["roomId"])
  .index("by_room_player", ["roomId", "playerId"])
  .index("by_match", ["matchExtId"]),
```
Invariant: **at most one bet per `(roomId, playerId, matchExtId)`** — enforced in
the mutation (query `by_room_player`, replace existing).

---

## 6. Backend — new `convex/betting.ts`

All identity derived server-side via `getAuthUserId` (never trust a client arg),
mirroring `convex/rooms.ts` (`requireUser`, `convex/rooms.ts:256`).

### Derived bankroll helper (the core of the whole feature)
Pure function over a player's bets + the `matches` table. Reused by `placeBet`
validation and by `standings`.

```
For a player's bets:
  settledNet = Σ over bets whose match is FINISHED with a winner:
                 pick === winner ?  (round(stake * odds) - stake)   // net profit
                                 :  (-stake)                        // lost stake
  pendingStakes = Σ stake over bets whose match is NOT yet FINISHED
  bankroll  = startingPot + settledNet        // what adds to the leaderboard
  available = bankroll - pendingStakes         // what can still be staked
```
- Round payouts with `Math.round(stake * odds)`.
- "Finished" = `match.status === "FINISHED" && match.winner != null`.
- Pending stake stays counted in `bankroll` (held, not lost) until its match
  finishes; it is only removed from `available`.

### Queries
- `bettableMatches({ code })` → for a room whose `status === "done"` and
  `startingPot > 0`: every match with `status` in `{SCHEDULED, TIMED}` whose
  both teams have a POOL rank, with computed odds per outcome (2-way for KO,
  3-way for group), plus the viewer's existing bet on each (if any). Sort by
  `utcDate`. Returns `[]` if betting is off.
- `myBankroll({ code })` → the viewer's `{ startingPot, bankroll, available,
  pendingStakes, settledNet }`.
- `myBets({ code })` → the viewer's open + settled bets with resolved match info
  (teams, flags, status, winner, settled win/loss amount).
- **Visibility rule (Q14):** these only ever expose the *viewer's own* picks.
  Other players' individual picks are never returned until the match has kicked
  off (`status !== SCHEDULED && !== TIMED`). Bankroll *totals* are public via
  `standings`.

### Mutations
- `placeBet({ code, matchExtId, pick, stake })`:
  - Require auth; room exists; viewer is a member (`players` row).
  - `room.status === "done"` and `(room.startingPot ?? 0) > 0`, else throw.
  - Match exists, `status` in `{SCHEDULED, TIMED}` (else "betting closed for this
    match"); both teams ranked.
  - `pick` valid for the stage (no `DRAW` when `stage !== GROUP_STAGE`).
  - `stake` is an integer ≥ 1.
  - Compute `available` (excluding any existing bet on THIS match, since edit
    replaces it); require `stake <= available`.
  - Compute `odds` for the chosen outcome now and snapshot it.
  - Upsert: if a bet on `(room, player, match)` exists, patch it; else insert.
- `cancelBet({ code, matchExtId })`: delete the viewer's bet on that match;
  refuse if the match has kicked off.

> No settlement mutation exists — settlement is derived (Q11). A re-synced /
> corrected match result automatically re-settles every bet on next read.

### Change to `convex/results.ts` → `standings`
Fold bankroll into each row:
- Load the room's `bets` once (`by_room`) and the `matches` (already loaded).
- For each player compute `bankroll` via the helper.
- `total = drawTotal + bankroll` (keep the existing `drawTotal` available too,
  for display). Add `bankroll`, `pendingStakes`, and ideally `settledNet` to the
  returned row.
- When `(room.startingPot ?? 0) === 0`, bankroll is omitted/0 and behaviour is
  identical to today.

### Change to `convex/rooms.ts`
- `createRoom`: accept `startingPot?: number`; clamp
  `Math.min(STARTING_POT_MAX, Math.max(0, Math.round(startingPot ?? STARTING_POT_DEFAULT)))`;
  store on the room (same shape as the existing `entryFee` clamp,
  `convex/rooms.ts:399`).
- New `setPot({ code, startingPot })` mutation mirroring `setMode`
  (`convex/rooms.ts:452`): host-only, clamp identically. **Allowed when
  `status === "lobby"`, OR when `status === "done"` and the tournament has not
  kicked off** — i.e. no match in `matches` has `status` in
  `{IN_PLAY, PAUSED, FINISHED}`. Refuse during `drawing`, and refuse once any WC
  match has kicked off (this is what locks the pot once betting could be live —
  it blocks both enabling betting on known results and retroactively shifting
  everyone's bankroll baseline after bets exist). Enabling a pot on a `done`
  room opens betting immediately.
- `deleteRoom` (`convex/rooms.ts:963`): also delete the room's `bets`
  (query `by_room`, delete each) alongside teams/players.
- `resetRoom` (`convex/rooms.ts:995`): also delete the room's `bets` so a
  re-draw starts clean.

---

## 7. Frontend changes

### `src/LiveApp.tsx`
1. **Create/join form** (~`225–410`): add a `startingPot` control next to
   `buyIn`/`mode`. As the host changes it, show a **live impact label** derived
   from the band thresholds:
   - `0` → "Betting off for this room."
   - `1–15` → "Nudge — the draw decides the room; betting just shuffles close places."
   - `16–39` → "Co-equal — a hot or cold betting run can overturn the draw." *(30 default)*
   - `40+` → "Dominant — betting outweighs the draw."
   Pass `startingPot` to the `createRoom` mutation. If editing in the lobby, call
   `setPot`.
2. **New `Betting` `CollapsibleSection`** rendered in the `done` view (near
   Standings, `src/LiveApp.tsx:1078`), only when `room.startingPot > 0`. Shows:
   - Bankroll header: **available / in-play (pending) / settled P&L** (from
     `myBankroll`).
   - Bettable fixtures (`bettableMatches`): each row shows both teams + flags,
     the outcome buttons with their odds (H/D/A or H/A), a whole-number stake
     input, and place/edit/cancel. Disable when `available` is insufficient.
   - "Your bets": open bets (with potential return) + settled bets (win/loss).
3. **`Standings` component** (`src/LiveApp.tsx:1188`): add a **bankroll chip**
   to each player row alongside the team chips, and make the displayed total the
   combined `drawTotal + bankroll`. Indicate pending stakes as "in play" on the
   viewer's own row. Keep the existing subtitle but note betting if pot > 0.

### `src/App.tsx`
No new route required (betting lives inside the room). Optionally mention
betting on `/how-it-works` (`src/HowItWorks.tsx`).

---

## 8. Lifecycle & validation summary

- Betting opens when `room.status === "done"` **and** `startingPot > 0`.
- Pot is set at create and editable via `setPot` while `status === "lobby"` OR
  while `status === "done"` **and no WC match has kicked off**. Once the
  tournament starts (first match `IN_PLAY`/`PAUSED`/`FINISHED`), the pot is
  **locked** everywhere. This lets existing/already-drawn games opt in
  pre-tournament while keeping bankroll baselines fixed once bets are live.
- A bet is placeable while its match is `SCHEDULED`/`TIMED`; editable/cancellable
  until then; **locked** at `IN_PLAY`/`FINISHED`.
- Settlement is automatic & derived: `FINISHED` + `winner` ⇒ win if
  `pick === winner`.
- `available = startingPot + settledNet − pendingStakes`; every stake ≥ 1 and
  ≤ available (excluding the bet being replaced).

---

## 9. Edge cases / micro-defaults

- **Unrankable team** (name-mapping miss → no POOL rank): match is **not
  bettable**. (Improve `ALIASES` in `convex/results.ts` if a real WC team slips
  through.)
- **Abandoned / never-FINISHED match:** stake stays **pending forever** (held,
  not refunded). Acceptable for v1; a host "void match" tool could come later.
- **Corrected results:** handled for free by the derived model — re-sync patches
  the match, next `standings` read re-settles.
- **Penalty shootouts:** football-data reports the post-shootout `winner` as
  `HOME`/`AWAY`; that is the bet outcome (confirmed intended).
- **Knockout fixtures with null teams** (bracket not filled): `syncResults`
  already skips them; they simply won't appear as bettable until populated.
- **Pre-existing rooms:** `startingPot` undefined ⇒ betting off; no behaviour
  change.

---

## 10. Suggested implementation order

1. `convex/pool.ts`: add constants + odds helpers (§4). Pure, unit-testable.
2. `convex/schema.ts`: add `rooms.startingPot` + `bets` table (§5).
3. `convex/betting.ts`: bankroll helper, queries, mutations (§6).
4. `convex/results.ts`: fold bankroll into `standings` (§6).
5. `convex/rooms.ts`: `createRoom` pot arg, `setPot`, cleanup in
   `deleteRoom`/`resetRoom` (§6).
6. `src/LiveApp.tsx`: create-form pot control + impact label; `Betting` section;
   `Standings` bankroll chip (§7).
7. Verify end-to-end (see §11).

---

## 11. Verification

- **Odds unit checks:** assert EV ≈ 0 for several gaps; assert clamp bounds;
  assert group probs sum to 1; assert KO has no draw.
- **Bankroll math:** start 30, stake 50 invalid (exceeds available); stake 20 on
  ×2 win → bankroll 30 − 20 + round(20×2) = 50; same bet lost → 10; all-in then
  lose → 0 (floored, never negative).
- **Derived re-settlement:** flip a match `FINISHED` then change its `winner` via
  a re-sync; confirm `standings` total moves without any settlement mutation.
- **Visibility:** another player's pre-kickoff pick is not returned by any query;
  their bankroll total IS visible in `standings`.
- **Lock rules:** `placeBet` rejected when pot = 0, when room not `done`, when
  match kicked off, when `DRAW` chosen on a knockout, when stake > available.
- **Pot lock:** `setPot` accepted in `lobby` and on a `done` room while no match
  has kicked off; rejected during `drawing` and once any WC match is
  `IN_PLAY`/`PAUSED`/`FINISHED`. Confirm an existing `done` room can opt in
  pre-tournament.
- Manual run via the `verify`/`run` skills against a live room.

---

## Appendix A — calibration evidence

Monte-Carlo of 4,000 full tournaments (group stage + knockouts), 16-player rooms,
scored exactly like `standings` (3/1/0, African ×2):

```
Player draw-score totals:
  min 0   p10 15   p25 20   median 27   p75 34   p90 43   max 80
  mean 27.8     p10..p90 spread = 28 points
```

A 30-point pot can swing a player roughly −30…+30 (net), comparable to the
entire p10→p90 draw spread → **co-equal** with the draw (the chosen target).
Bands: ≤15 nudge, 16–39 co-equal, 40+ dominant.

## Appendix B — bankroll archetype simulation (fair-odds feel)

With fair odds, no model rewards "always back the favourite":
- Favourite-hammer (big stakes on locks) trends **down** — risks a lot to win
  ×1.05 slivers, wiped by occasional upsets.
- Cautious small stakes preserve the pot, grow slowly.
- Underdog-hunting is high-variance (big swings up and down).
- Skill = a private read the rank-based odds don't capture → genuine +EV.

(Reproduction scripts used during design lived in `/tmp/oddsim.mjs`,
`/tmp/banksim.mjs`, `/tmp/fair.mjs`, `/tmp/drawsim.mjs` — re-derive from §4 if
needed; they are not committed.)
