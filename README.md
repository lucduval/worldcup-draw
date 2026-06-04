# World Cup Draw 🏆

A tiny sweepstake for **your mates** (not the office). Players take turns
blind-drawing **one team from each of three tiers**; a suspense reveal fires
before each team flips onto the board. R100 in, three teams each, winner takes
the pool.

Two ways to play, chosen on the home screen:

- **🔴 Live match play** — everyone on their own phone. **Sign in with an
  email + password**, and your **My games** list follows you across devices —
  be in as many draws as you like (the friends' draw, the family draw…). You
  only ever see games you're in. Share a 4-letter room code to pull people into
  a draw; everything syncs in real time, each player gets their own suspense
  reveal. Uses the Convex backend (with Convex Auth).
- **💻 Local game (one device)** — set the draw up on one laptop, add the
  players, and pass it around; turns go one at a time on that screen. **No
  internet and no backend setup** — works even if you never touch Convex.

- **Frontend:** Vite + React + TypeScript (one `src/App.tsx`, styling ported from `wc-draw.html`)
- **Realtime backend:** [Convex](https://convex.dev) (`convex/`)
- **Hosting:** Vercel

`wc-draw.html` is kept as the original static design reference.

---

## 1. Install

```bash
npm install
```

> Want **Local mode only**? You can skip steps 2 and just run `npm run dev`
> (step 3). Pick "Local game" on the home screen — Convex is never loaded.
> The Convex steps below are only needed for cross-phone Live play.

## 2. Connect Convex (one time, by you — Live mode only)

```bash
npx convex dev
```

This logs you in, creates a dev deployment, generates `convex/_generated/*`,
and writes your `VITE_CONVEX_URL` into `.env.local`. **Leave it running** in its
own terminal — it watches `convex/` and pushes function changes live.

## 3. Run the app locally

In a second terminal:

```bash
npm run dev
```

Open the printed URL. To test "between phones" on your home Wi-Fi, run
`npm run dev -- --host` and open the Network URL on your phone.

---

## How the game works

| Setting        | Value                                        |
| -------------- | -------------------------------------------- |
| Buy-in         | R100 (edit `ENTRY_FEE` in `convex/pool.ts`)  |
| Teams per tier | 16 → **max 16 players**                      |
| Teams drawn    | 3 per player, one from each tier             |
| Turn order     | Random snake order, set when the host starts |
| The pool       | 48 nations in `convex/pool.ts` — edit freely |

1. Everyone **signs in** (email + password) and lands on **My games** — the list
   of every draw they're in.
2. Someone taps **Start a new draw**, names it (e.g. "Friends' draw"), gets a
   4-letter code (e.g. `WC7K`), and shares it.
3. Friends sign in, tap **Join draw**, and enter the code — the game then shows
   up in their My games list too. The host taps **Lock it in & start** — a
   random player is put first.
4. On your turn, tap **Draw**. A 🥁 overlay plays on *every* phone, then the
   team is revealed together. Round 1 = Tier 1, round 2 = Tier 2, round 3 = Tier 3.
5. Everyone always sees everyone's squads on the board. Done when all squads are full.

Host can **reset draw** to run it again with the same group.

### Fixtures

Every screen shows a **Fixtures** card with the next few kickoffs, plus a
**Full schedule →** button that slides in a side panel with all 104 matches
(72 group games with real teams + the knockout bracket as dated slots). In Live
mode the card personalises to **your drawn teams' next games**, and the panel
has an *All / My teams* filter. All times shown in **SAST**. The schedule data
lives in [src/fixtures.ts](src/fixtures.ts) — kickoffs are stored as UTC and
rendered in SA time, so it's easy to retarget the timezone later.

---

## 4. Deploy to Vercel

Push this folder to a Git repo and import it on Vercel, then:

**a.** Get a Convex **production** deploy key:
`npx convex dashboard` → Project → Settings → *Deploy Keys* → generate a Production key.

**b.** In Vercel → Project → Settings → Environment Variables, add:

```
CONVEX_DEPLOY_KEY = <the production deploy key>
```

**c.** Set Vercel's **Build Command** to:

```
npx convex deploy --cmd 'npm run build'
```

This deploys your Convex functions to production and injects the matching
`VITE_CONVEX_URL` into the build automatically. Output dir stays `dist`
(Vite default). Share the Vercel URL in the group chat and you're live.

> Tip: keep the buy-in honest — settle the actual R100s in person/EFT. The app
> just runs the draw; it doesn't move money.
