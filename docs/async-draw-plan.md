# Async "watch-anytime" draw mode

## Goal

Today a draw is a single shared live state: `room.pickIndex` advances globally and
everyone has to be present at once, tapping in real time. If people aren't all at
their phones together, the draw stalls on whoever's turn it is, or the host has to
bail everyone out — and latecomers just see the finished board, missing the fun.

This feature lets **every player get the same experience on their own schedule**.
The result is computed once in the backend, and each player logs in whenever they
like and **watches the draw play out** — others' picks reveal automatically, but
when it reaches *their* turn the replay pauses and they tap the dice to reveal
their own team. It must coexist with the existing live manual draw.

## Decisions (locked with the user)

1. **Per-viewer playback.** When a player watches, the replay auto-reveals every
   other player's pick, but **pauses on the watcher's own turns** so they tap the
   dice themselves. Each viewer has their own independent playback cursor.
2. **Trigger = host taps "Run the draw now."** From the lobby, the host runs the
   draw on demand; the full random result is computed server-side at that moment.
   From then on, anyone can open the app and watch.
3. **Mode is a per-game choice by the host.** Two distinct modes:
   - **Live draw** — current behaviour, unchanged (everyone present, tap in real time).
   - **Async draw** — compute now, everyone watches in their own time.
4. **Hide the result until watched.** Until a player has played through their own
   walk-through, *their* view of their teams / the full board / standings stays
   hidden. Surprise is preserved per-player.
5. **African bonus pick stays a real, free choice.** It is **not** part of the
   animation. The walk-through only animates the random **tier** selection. The
   draw is **not fully locked until every player has chosen their African team**
   (same rule as today). Order doesn't matter: tier teams are pre-computed at run
   time, and the African picker already disables the three nations a player was
   dealt, so the bonus pick can never collide with a tier pick.
6. **Reminder is in-app only.** A clear "Action needed" banner/badge in the
   *My games* list and in the room, for players who still owe an African pick (or
   haven't watched their draw yet). No email/push infrastructure.
7. **Host force-lock for stragglers.** If a player never shows up to pick their
   African team, the host can tap a button that assigns a random African team to
   no-shows and locks the draw (reuse of today's `autoAllocate` idea). Host decides
   when to stop waiting.
8. **Replay scope: full sequence, others fast, own turn slower.** Play the whole
   draw in real pick order. Other players' picks auto-reveal *quickly*; the
   watcher's own reveal **dwells noticeably longer** than today — the current
   `REVEAL_MS` (3200 ms) is too fast for the moment that actually matters.

## What does NOT change

- Live mode keeps its exact current flow (`startGame` → `drawing` → players tap →
  `hostDraw` for absentees → `done`).
- Tier re-seeding (`retierForDraw`), snake order (`whoseTurn`), `pickTierTeam`
  exclusion logic, standings, fixtures, the African picker UI.

---

## Data model changes (`convex/schema.ts`)

### `rooms`
- Add `mode: v.optional(v.union(v.literal("live"), v.literal("async")))`.
  Optional so existing rooms default to `"live"`. Set at `createRoom`.
- (Status enum unchanged: `lobby | drawing | done`. In async mode, `drawing` means
  "result computed, players watching"; `done` means "fully locked".)

### `players`
- Add `watchedAt: v.optional(v.number())` — wall-clock ms when this player
  completed their walk-through. Drives per-player spoiler gating and the
  "hasn't watched yet" reminder. `undefined` = hasn't watched.

No new tables. The pre-computed result lives in the existing `teams.ownerId`
assignments (set at run time) — `teams.assignedAt` is left **unused** in async
mode so the live-draw reveal-timing logic doesn't fire globally; per-viewer
reveal timing is client-side (see below).

---

## Backend changes (`convex/rooms.ts`)

### `createRoom`
- Accept `mode` arg (default `"live"`); store it on the room.

### New mutation: `runAsyncDraw({ code })`  (host only, async rooms)
Essentially `startGame` + the tier-assignment half of `autoAllocate`, but it does
**not** flip to `done` and does **not** touch African picks:
1. Host check; require `status === "lobby"`, `mode === "async"`, ≥2 players.
2. `turnOrder = shuffle(players)`, `retierForDraw(teams, players.length)`.
3. Assign every tier pick now via `whoseTurn` + `pickTierTeam`, excluding each
   player's African pick *if they already chose one* (else no exclusion — the
   picker handles collisions later). Set `ownerId` but **leave `assignedAt`
   unset** (no global reveal clock).
4. `status: "drawing"`, `pickIndex: total` (the tier draw is fully resolved;
   playback is purely a client concern now).
5. Lock condition is checked separately — room stays `drawing` until all African
   picks are in (see `pickAfrican` and `forceLockAsync`).

### `pickAfrican`
- Already locks the room to `done` once the tier draw is complete and the last
  African pick lands. In async mode `pickIndex >= total` is already true after
  `runAsyncDraw`, so the existing lock branch works as-is. ✅ Verify the condition
  holds for async and add the `mode`-agnostic guard.

### New mutation: `markWatched({ code })`
- Sets the caller's `players.watchedAt = Date.now()` (idempotent — only set if
  unset). Called by the client when a player finishes their walk-through. Drives
  spoiler reveal + clears their reminder.

### New mutation: `forceLockAsync({ code })`  (host only)
- Async-mode "stop waiting": assign a random African nation to any player without
  one (like `autoAllocate`'s African loop), then `status: "done"`. Tier picks are
  already assigned, so this only fills missing African picks and locks.

### `getRoom`
- Return `room.mode` and each player's `watchedAt`.
- **Spoiler gating (server-side, async only):** when the room is async and the
  caller's own `watchedAt` is unset, withhold the result from the payload so it
  can't be inspected before they watch. Concretely, for an un-watched caller:
  - return `teams` with `ownerId`/tier-assignment stripped (or omit owners), and
  - signal `needsWatch: true` plus the caller's own pre-computed picks delivered
    only as a **playback script** (ordered list of `{pickIndex, playerId, tier,
    teamId}`) that the client animates. The watcher's own teams arrive via the
    script too, revealed only as they tap.
  > Trade-off note: simplest version hides client-side only (send everything,
  > blur in UI). Given this is a casual friends' game, client-side hiding may be
  > acceptable and far less code. **Recommend** server-side withholding for the
  > caller's own un-watched picks at minimum, since that's the part with real
  > suspense. Decide at implementation time.

### `autoAllocate`, `hostDraw`, `draw`, `startGame`
- Keep for live mode. `draw`/`hostDraw`/`startGame` should reject async rooms with
  a clear error (async uses `runAsyncDraw` + per-viewer playback, no server turns).

---

## Reveal timing (`convex/pool.ts`)

- Keep `REVEAL_MS = 3200` for the live shared draw.
- Add async client-side constants (client-only, can live in `shared.tsx` or pool):
  - `ASYNC_OTHERS_MS` ≈ 900–1200 ms (quick auto-reveal of other players' picks).
  - `ASYNC_MINE_MS` ≈ 4500–5500 ms (longer, suspenseful dwell on the watcher's own
    reveal — explicitly slower than today).
- Tune to taste; the user noted the current reveal is "too fast."

---

## Frontend changes (`src/LiveApp.tsx`, `src/shared.tsx`)

### Create-game form (`GamesList`)
- Add a mode toggle: **Live draw** vs **Watch anytime (async)**, with a one-line
  explanation of each. Pass `mode` to `createRoom`.

### Lobby (async room)
- Replace "Lock it in & start the draw" with **"Run the draw now"** (host only)
  → calls `runAsyncDraw`. Same ≥2-player guard.
- Show the African picker (unchanged) and a note that picks can still be made/
  changed until the draw locks.

### Replay player (new component, async `drawing` state)
- Drives a **local playback cursor** from the script returned by `getRoom`.
- Iterates picks in `pickIndex` order:
  - other players' turns: auto-reveal using `ASYNC_OTHERS_MS`, then advance.
  - the watcher's own turn: **pause**, show "It's your turn — tap to draw", reveal
    with `ASYNC_MINE_MS` dwell on tap, then advance.
- Reuse `RevealOverlay` and the `PlayerCard` reveal styling for visual continuity.
- On reaching the end → call `markWatched`, then show the normal final board +
  standings for that player.
- Optional **"Skip / replay"** control is out of scope for v1 (user chose full
  sequence); a simple "Replay" button after completion is a nice-to-have.

### Spoiler gating (UI)
- For an async player with `watchedAt` unset: hide/blur the Squads board,
  standings, and their own teams; show the replay entry point instead
  ("▶ Watch your draw").
- Once `watchedAt` is set (or in live mode), render the board exactly as today.

### Reminder banners (in-app)
- *My games* list: badge on async games where the signed-in player owes an
  African pick or hasn't watched ("Action needed").
- In-room: banner prompting the African pick if missing; prompt to watch if not
  yet watched.
- Host view: surface how many players still owe an African pick, plus the
  **"Force-lock (random for no-shows)"** button → `forceLockAsync`.

---

## Edge cases & notes

- **African pick before vs after run:** allowed either way. If picked before
  `runAsyncDraw`, that nation is excluded from their tier draw. If picked after,
  the picker disables their three dealt teams. Either way, no collision.
- **Host is also a player:** the host watches their own walk-through like everyone
  else after running the draw.
- **Re-watch:** after `watchedAt` is set, default to showing the final board; a
  "Replay" button can re-run the local animation without changing state.
- **Reset (`resetRoom`):** must also clear every player's `watchedAt`.
- **Standings/pool:** unchanged — they key off `status === "done"`, which async
  reaches once all African picks are in (or host force-locks).
- **Cross-device watched state:** `watchedAt` is server-side, so finishing on a
  phone is remembered on a laptop.

## Build order (suggested)

1. Schema: `rooms.mode`, `players.watchedAt`.
2. `createRoom` mode arg + create-form toggle.
3. `runAsyncDraw`, `markWatched`, `forceLockAsync` mutations; guard live-only
   mutations against async rooms.
4. `getRoom` mode/watched fields + spoiler gating.
5. Replay component + async reveal timing constants.
6. Spoiler gating UI + reminder banners + host force-lock button.
7. `resetRoom` clears `watchedAt`.
8. Manual test: live mode unchanged; async run → watch as host → watch as a second
   account → straggler force-lock → standings.
