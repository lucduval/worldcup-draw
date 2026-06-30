import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Convex Auth's built-in tables (users, sessions, etc.). `users` holds the
  // signed-in account; we reference it as the owner of rooms and players.
  ...authTables,

  // Override Auth's `users` table to add `imageId` - a reference to the
  // profile picture in Convex file storage. All other fields mirror the
  // built-in Auth schema verbatim (see @convex-dev/auth authTables).
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    imageId: v.optional(v.id("_storage")), // profile picture in file storage
    // Whether this account has seen the first-login "how it works" walkthrough.
    // Optional so existing accounts read as not-yet-seen (undefined ⇒ show once).
    seenIntro: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  rooms: defineTable({
    name: v.string(), // human label, e.g. "Friends' draw"
    code: v.string(),
    status: v.union(
      v.literal("lobby"),
      v.literal("drawing"),
      v.literal("done"),
    ),
    hostId: v.id("users"), // the account that created the game
    // Draw style. "live" = everyone present, tapping in real time (the original
    // flow). "async" = result computed once via runAsyncDraw, then each player
    // watches it play out on their own schedule. Optional so rooms created
    // before this field default to "live".
    mode: v.optional(v.union(v.literal("live"), v.literal("async"))),
    // Per-draw buy-in (Rand) chosen by the host. Optional so rooms created
    // before this field fall back to the ENTRY_FEE default.
    entryFee: v.optional(v.number()),
    // Per-player starting betting bankroll (whole points), host-set in the lobby
    // or on a not-yet-kicked-off `done` room (see setPot). 0 disables betting.
    // Optional so pre-existing rooms read as "betting off" (undefined ⇒ 0) and
    // never silently gain the feature. New rooms default to STARTING_POT_DEFAULT.
    startingPot: v.optional(v.number()),
    // Host knob for mid-tournament coin re-buys (see pool.ts `purchaseCapOf`).
    // Three states, stored unambiguously: `purchaseUnlimited === true` ⇒
    // unlimited; else a positive `purchaseCap` ⇒ that per-player ceiling; else
    // (both absent) ⇒ Off. Off is the default for all existing and new rooms, so
    // a game never silently gains real-money re-buys. Independent of
    // `startingPot` (every player gets the same allowance on top of the free
    // pot) and NOT locked by bets — the host can adjust it any time the room
    // isn't mid-draw (see setPurchaseCap).
    purchaseCap: v.optional(v.number()),
    purchaseUnlimited: v.optional(v.boolean()),
    // Legacy host-toggled bet visibility (superseded by `betVisibility`). Kept
    // for backward-compatible reads: `betVisibilityOf` falls back to it (public
    // when true, hidden otherwise) for rooms created before `betVisibility`.
    betsPublic: v.optional(v.boolean()),
    // Host-chosen three-way bet visibility (see `betVisibilityOf`):
    //   "hidden"  bets are private — each player only sees their own.
    //   "live"    a player's bet on a match is exposed to everyone once that
    //             match has kicked off, and stays visible after it finishes.
    //   "public"  every bet is visible to everyone immediately.
    // Optional so pre-existing rooms fall back to the legacy `betsPublic` flag.
    betVisibility: v.optional(
      v.union(v.literal("hidden"), v.literal("live"), v.literal("public")),
    ),
    turnOrder: v.array(v.id("players")), // set when the game starts
    pickIndex: v.number(), // how many picks have been made
    // Live-mode turn timer (host-toggled, see setTimer). When `timerEnabled`,
    // each turn gets `timerSeconds` on the clock; `turnDeadline` is the
    // wall-clock ms the current turn auto-resolves, and `timerJobId` is the
    // scheduled auto-pick so it can be cancelled when the turn advances early.
    // All optional so existing rooms default to "timer off".
    timerEnabled: v.optional(v.boolean()),
    timerSeconds: v.optional(v.number()),
    turnDeadline: v.optional(v.number()),
    timerJobId: v.optional(v.id("_scheduled_functions")),
  }).index("by_code", ["code"]),

  players: defineTable({
    roomId: v.id("rooms"),
    userId: v.id("users"), // the account behind this seat
    name: v.string(),
    joinedAt: v.number(),
    // The African team this player chose in the bonus round. Duplicates across
    // players are allowed, so this is stored on the seat, not via team owners.
    africanTeam: v.optional(
      v.object({ name: v.string(), flag: v.string() }),
    ),
    // Async mode only: wall-clock ms when this player finished watching their
    // walk-through. Drives per-player spoiler gating and the "hasn't watched
    // yet" reminder. `undefined` = hasn't watched (or live mode).
    watchedAt: v.optional(v.number()),
    // Cumulative coins this seat has bought mid-tournament (see betting.ts
    // buyCoins). Adds to what the player can stake (Available) but never to
    // their leaderboard score. Absent ⇒ 0. Wiped on re-draw with the bets.
    purchasedCoins: v.optional(v.number()),
  })
    .index("by_room", ["roomId"])
    .index("by_user", ["userId"]), // powers each account's "My games" list

  teams: defineTable({
    roomId: v.id("rooms"),
    name: v.string(),
    flag: v.string(),
    tier: v.number(),
    ownerId: v.optional(v.id("players")),
    assignedAt: v.optional(v.number()), // wall-clock ms of the pick
  }).index("by_room", ["roomId"]),

  // Per-room match bets. The bankroll is never stored - it is derived on read
  // from these rows plus the shared `matches` table (see convex/betting.ts), so
  // a corrected result auto-re-settles. Invariant: at most one bet per
  // (roomId, playerId, matchExtId), enforced in placeBet (edit replaces).
  bets: defineTable({
    roomId: v.id("rooms"),
    playerId: v.id("players"),
    userId: v.id("users"), // denormalised for ownership checks
    matchExtId: v.number(), // -> matches.extId
    pick: v.union(v.literal("HOME"), v.literal("DRAW"), v.literal("AWAY")),
    stake: v.number(), // whole number, >= 1
    odds: v.number(), // decimal odds snapshotted at placement
    placedAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_player", ["roomId", "playerId"]),

  // World Cup match results, synced from football-data.org. Shared by every
  // room - standings are computed per room from the teams each player owns.
  // Team names are normalised to our pool names on the way in (see results.ts).
  matches: defineTable({
    extId: v.number(), // football-data match id (for idempotent upserts)
    stage: v.string(), // GROUP_STAGE, ROUND_OF_16, ...
    status: v.string(), // FINISHED, SCHEDULED, IN_PLAY, ...
    homeTeam: v.string(),
    awayTeam: v.string(),
    // The result score after 90' + extra time, EXCLUDING any shootout. The feed's
    // `fullTime` folds penalties in for shootout games (e.g. 4-5), so for those we
    // store regulation+ET instead (the level 1-1) and keep the shootout separate.
    homeGoals: v.optional(v.number()),
    awayGoals: v.optional(v.number()),
    // Penalty shootout tally, present only for matches that went to penalties.
    penaltiesHome: v.optional(v.number()),
    penaltiesAway: v.optional(v.number()),
    // How the match was decided: "REGULAR" | "EXTRA_TIME" | "PENALTY_SHOOTOUT".
    // Drives the FT/AET tag and whether a shootout actually happened.
    duration: v.optional(v.string()),
    // Result once finished: which side took the points. Knockouts are decided
    // by the final result (after ET/penalties), so they're never a draw.
    winner: v.optional(
      v.union(v.literal("HOME"), v.literal("AWAY"), v.literal("DRAW")),
    ),
    utcDate: v.string(),
    // Live market odds, synced from odds-api.io and de-vigged to fair decimal
    // odds (see results.ts syncOdds). Optional: a fixture the odds feed hasn't
    // priced (or that we couldn't name-match) keeps these undefined and falls
    // back to the rank-based model in betting.ts. Stored per outcome; `oddsDraw`
    // is absent for knockouts. `oddsUpdatedAt` is the feed's freshest line time.
    oddsHome: v.optional(v.number()),
    oddsDraw: v.optional(v.number()),
    oddsAway: v.optional(v.number()),
    oddsUpdatedAt: v.optional(v.number()),
  }).index("by_ext", ["extId"]),

  // Group standings synced from football-data.org - one row per group (A–L),
  // each holding its ordered table. Team names/flags normalised to our pool.
  groupStandings: defineTable({
    group: v.string(), // "Group A"
    order: v.number(), // 0..11, for stable display ordering
    table: v.array(
      v.object({
        position: v.number(),
        teamName: v.string(),
        flag: v.string(),
        played: v.number(),
        won: v.number(),
        draw: v.number(),
        lost: v.number(),
        goalsFor: v.number(),
        goalsAgainst: v.number(),
        goalDifference: v.number(),
        points: v.number(),
        form: v.optional(v.string()),
      }),
    ),
  }).index("by_group", ["group"]),
});
