import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id, Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  POOL,
  RANK_BY_NAME,
  matchOdds,
  apiMatchOdds,
  type BetPick,
} from "./pool";

// Flag lookup for the canonical pool names stored on matches.
const FLAG_BY_NAME: Record<string, string> = Object.fromEntries(
  POOL.map((t) => [t.name, t.flag]),
);

// A match is "kicked off" (no longer bettable / editable) once it leaves the
// pre-match states. SCHEDULED/TIMED are still open; everything else is locked.
function isOpen(status: string): boolean {
  return status === "SCHEDULED" || status === "TIMED";
}
function isFinished(m: { status: string; winner?: BetPick }): boolean {
  return m.status === "FINISHED" && m.winner != null;
}

// The room's three visibility modes for other players' bets.
export type BetVisibility = "hidden" | "live" | "public";

// Effective bet visibility for a room: honours the three-way `betVisibility`
// field and falls back to the legacy `betsPublic` boolean for rooms created
// before it existed (public when true, hidden otherwise).
function betVisibilityOf(room: Doc<"rooms">): BetVisibility {
  return room.betVisibility ?? (room.betsPublic ? "public" : "hidden");
}

// A match is bettable only if both teams resolve to a POOL rank (a name-mapping
// miss leaves a team unranked, so we can't price it).
function ranksFor(
  m: Doc<"matches">,
): { homeRank: number; awayRank: number } | null {
  const homeRank = RANK_BY_NAME[m.homeTeam];
  const awayRank = RANK_BY_NAME[m.awayTeam];
  if (homeRank === undefined || awayRank === undefined) return null;
  return { homeRank, awayRank };
}

// Odds for a match: prefer the live market odds synced onto the match (de-vigged
// to fair odds in results.ts), falling back to the rank-based model when the feed
// hasn't priced this fixture. `live` flags which source was used so the client
// can label market odds. Single source of truth for both display and placement.
function oddsForMatch(
  m: Doc<"matches">,
  ranks: { homeRank: number; awayRank: number },
  isKnockout: boolean,
): { odds: { HOME: number; AWAY: number; DRAW?: number }; live: boolean } {
  if (m.oddsHome != null && m.oddsAway != null) {
    return {
      odds: apiMatchOdds(
        { home: m.oddsHome, draw: m.oddsDraw, away: m.oddsAway },
        isKnockout,
      ),
      live: true,
    };
  }
  return {
    odds: matchOdds(ranks.homeRank, ranks.awayRank, isKnockout),
    live: false,
  };
}

// ── Derived bankroll ─────────────────────────────────────────────────────────
// The whole feature in one pure function: a player's bankroll is never stored,
// it is recomputed from their bets + the matches table on every read (mirrors
// how `standings` derives draw scores). Reused by placeBet validation, the
// betting queries, and `standings`.
//
//   settledNet    = Σ over FINISHED bets: won ? round(stake*odds)-stake : -stake
//   pendingStakes = Σ stake over bets whose match hasn't FINISHED yet
//   bankroll      = max(0, startingPot + settledNet)  (what folds into the score)
//   available     = max(0, bankroll - pendingStakes)  (what can still be staked)
//
// A pending stake is held (still counted in bankroll) until its match settles;
// it is only withheld from `available`. The staking invariant (stake <=
// available) normally keeps the raw sum >= 0, but a host lowering the pot after
// bets exist, or a re-synced result, can push it negative; both are floored at 0
// here so every reader (standings, myBankroll, placeBet) agrees and a player
// never drops below their pure draw score.
export type Bankroll = {
  startingPot: number;
  bankroll: number;
  available: number;
  pendingStakes: number;
  settledNet: number;
};

export function computeBankroll(
  startingPot: number,
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
  const available = Math.max(0, bankroll - pendingStakes);
  return { startingPot, bankroll, available, pendingStakes, settledNet };
}

// ── Shared loaders ───────────────────────────────────────────────────────────
async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in to play.");
  return userId;
}

// Resolve the room + the viewer's seat in one place. Returns null when the room
// doesn't exist or the viewer isn't a member, so read queries can degrade to [].
async function viewerSeat(
  ctx: QueryCtx | MutationCtx,
  code: string,
  userId: Id<"users">,
): Promise<{ room: Doc<"rooms">; me: Doc<"players"> } | null> {
  const room = await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
  if (!room) return null;
  const players = await ctx.db
    .query("players")
    .withIndex("by_room", (q) => q.eq("roomId", room._id))
    .collect();
  const me = players.find((p) => p.userId === userId);
  if (!me) return null;
  return { room, me };
}

function bettingOpen(room: Doc<"rooms">): boolean {
  return room.status === "done" && (room.startingPot ?? 0) > 0;
}

// ── Queries ──────────────────────────────────────────────────────────────────

// Bettable fixtures for an open room: every still-SCHEDULED/TIMED match whose
// both teams have a POOL rank, priced per outcome, with the viewer's own bet (if
// any) attached. Returns [] when betting is off or the room isn't `done`.
// Visibility (Q14): only ever exposes the *viewer's own* pick.
export const bettableMatches = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const seat = await viewerSeat(ctx, code, userId);
    if (!seat || !bettingOpen(seat.room)) return [];

    const myBets = await ctx.db
      .query("bets")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", seat.room._id).eq("playerId", seat.me._id),
      )
      .collect();
    const myBetByMatch = new Map(myBets.map((b) => [b.matchExtId, b]));

    const matches = await ctx.db.query("matches").collect();
    const open = matches.filter((m) => isOpen(m.status));
    open.sort((a, b) => a.utcDate.localeCompare(b.utcDate));

    const out = [];
    for (const m of open) {
      const ranks = ranksFor(m);
      if (!ranks) continue; // unrankable team ⇒ not bettable
      const isKnockout = m.stage !== "GROUP_STAGE";
      const { odds, live } = oddsForMatch(m, ranks, isKnockout);
      const mine = myBetByMatch.get(m.extId);
      out.push({
        matchExtId: m.extId,
        stage: m.stage,
        isKnockout,
        status: m.status,
        utcDate: m.utcDate,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        homeFlag: FLAG_BY_NAME[m.homeTeam] ?? "🏳️",
        awayFlag: FLAG_BY_NAME[m.awayTeam] ?? "🏳️",
        odds,
        live,
        myBet: mine
          ? { pick: mine.pick, stake: mine.stake, odds: mine.odds }
          : null,
      });
    }
    return out;
  },
});

// The viewer's own bankroll breakdown for the room. Zeroed when betting is off.
export const myBankroll = query({
  args: { code: v.string() },
  handler: async (ctx, { code }): Promise<Bankroll | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const seat = await viewerSeat(ctx, code, userId);
    if (!seat) return null;
    const startingPot = seat.room.startingPot ?? 0;
    if (startingPot <= 0)
      return {
        startingPot: 0,
        bankroll: 0,
        available: 0,
        pendingStakes: 0,
        settledNet: 0,
      };

    const bets = await ctx.db
      .query("bets")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", seat.room._id).eq("playerId", seat.me._id),
      )
      .collect();
    const matches = await ctx.db.query("matches").collect();
    const matchByExtId = new Map(matches.map((m) => [m.extId, m]));
    return computeBankroll(startingPot, bets, matchByExtId);
  },
});

// The viewer's own bets with resolved match info + per-bet settlement. Open bets
// carry their potential return; settled bets carry the realised win/loss.
export const myBets = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const seat = await viewerSeat(ctx, code, userId);
    if (!seat) return [];

    const bets = await ctx.db
      .query("bets")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", seat.room._id).eq("playerId", seat.me._id),
      )
      .collect();
    const matches = await ctx.db.query("matches").collect();
    const matchByExtId = new Map(matches.map((m) => [m.extId, m]));

    const rows = bets.map((b) => {
      const m = matchByExtId.get(b.matchExtId);
      const finished = m ? isFinished(m) : false;
      const won = finished && b.pick === m!.winner;
      const potentialReturn = Math.round(b.stake * b.odds);
      return {
        matchExtId: b.matchExtId,
        pick: b.pick,
        stake: b.stake,
        odds: b.odds,
        placedAt: b.placedAt,
        potentialReturn, // gross return if it wins
        homeTeam: m?.homeTeam ?? "—",
        awayTeam: m?.awayTeam ?? "—",
        homeFlag: m ? (FLAG_BY_NAME[m.homeTeam] ?? "🏳️") : "🏳️",
        awayFlag: m ? (FLAG_BY_NAME[m.awayTeam] ?? "🏳️") : "🏳️",
        status: m?.status ?? "SCHEDULED",
        winner: m?.winner ?? null,
        open: !finished,
        // Net profit/loss once settled (0 while still open).
        settledNet: finished ? (won ? potentialReturn - b.stake : -b.stake) : 0,
        won: finished ? won : null,
      };
    });
    rows.sort((a, b) => b.placedAt - a.placedAt);
    return rows;
  },
});

// Everyone's bets, grouped by player, for a room with public betting turned on.
// Returns null when betting is off, the viewer isn't a member, or the host has
// not made bets public — so the client renders the section only when it should.
// Unlike the private queries this deliberately exposes every player's pick,
// stake and odds (the host opted the whole room into transparency).
export const roomBets = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const seat = await viewerSeat(ctx, code, userId);
    if (!seat || !bettingOpen(seat.room)) return null;
    const visibility = betVisibilityOf(seat.room);
    if (visibility === "hidden") return null;

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", seat.room._id))
      .collect();
    const nameById = new Map(players.map((p) => [p._id, p.name]));

    const bets = await ctx.db
      .query("bets")
      .withIndex("by_room", (q) => q.eq("roomId", seat.room._id))
      .collect();
    const matches = await ctx.db.query("matches").collect();
    const matchByExtId = new Map(matches.map((m) => [m.extId, m]));

    // One group per player who has placed at least one bet.
    const groups = new Map<
      Id<"players">,
      { playerId: Id<"players">; name: string; isMe: boolean; bets: any[] }
    >();
    for (const b of bets) {
      const m = matchByExtId.get(b.matchExtId);
      // In "live" mode a bet is only exposed to others once its match has
      // kicked off; still-open (SCHEDULED/TIMED) picks stay hidden until then.
      if (visibility === "live" && (!m || isOpen(m.status))) continue;
      const finished = m ? isFinished(m) : false;
      const won = finished && b.pick === m!.winner;
      const potentialReturn = Math.round(b.stake * b.odds);
      const row = {
        matchExtId: b.matchExtId,
        pick: b.pick,
        stake: b.stake,
        odds: b.odds,
        placedAt: b.placedAt,
        potentialReturn,
        homeTeam: m?.homeTeam ?? "—",
        awayTeam: m?.awayTeam ?? "—",
        homeFlag: m ? (FLAG_BY_NAME[m.homeTeam] ?? "🏳️") : "🏳️",
        awayFlag: m ? (FLAG_BY_NAME[m.awayTeam] ?? "🏳️") : "🏳️",
        status: m?.status ?? "SCHEDULED",
        winner: m?.winner ?? null,
        open: !finished,
        settledNet: finished ? (won ? potentialReturn - b.stake : -b.stake) : 0,
        won: finished ? won : null,
      };
      let g = groups.get(b.playerId);
      if (!g) {
        g = {
          playerId: b.playerId,
          name: nameById.get(b.playerId) ?? "Player",
          isMe: b.playerId === seat.me._id,
          bets: [],
        };
        groups.set(b.playerId, g);
      }
      g.bets.push(row);
    }

    const out = [...groups.values()];
    for (const g of out) g.bets.sort((a, b) => b.placedAt - a.placedAt);
    // Viewer first, then alphabetical, so each player finds their own row fast.
    out.sort((a, b) =>
      a.isMe === b.isMe ? a.name.localeCompare(b.name) : a.isMe ? -1 : 1,
    );
    return out;
  },
});

// ── Mutations ──────────────────────────────────────────────────────────────────

// Host-only switch for room-wide bet visibility (see `betVisibilityOf`):
// "hidden" keeps bets private, "live" reveals each bet to everyone once its
// match kicks off, and "public" exposes every bet immediately. Allowed on any
// `done` room with betting on (the betting layer's lifecycle).
export const setBetVisibility = mutation({
  args: {
    code: v.string(),
    mode: v.union(
      v.literal("hidden"),
      v.literal("live"),
      v.literal("public"),
    ),
  },
  handler: async (ctx, { code, mode }) => {
    const userId = await requireUser(ctx);
    const seat = await viewerSeat(ctx, code, userId);
    if (!seat) throw new Error("You're not in this game.");
    if (seat.room.hostId !== userId)
      throw new Error("Only the host can change bet visibility.");
    await ctx.db.patch(seat.room._id, { betVisibility: mode });
  },
});

// Place or replace a bet on a match. Identity is server-derived; odds are priced
// and snapshotted now. One bet per (room, player, match): an existing bet on the
// same match is patched (the replaced stake is freed before checking available).
export const placeBet = mutation({
  args: {
    code: v.string(),
    matchExtId: v.number(),
    pick: v.union(v.literal("HOME"), v.literal("DRAW"), v.literal("AWAY")),
    stake: v.number(),
  },
  handler: async (ctx, { code, matchExtId, pick, stake }) => {
    const userId = await requireUser(ctx);
    const seat = await viewerSeat(ctx, code, userId);
    if (!seat) throw new Error("You're not in this game.");
    const { room, me } = seat;

    if (room.status !== "done")
      throw new Error("Betting opens once the draw is locked.");
    const startingPot = room.startingPot ?? 0;
    if (startingPot <= 0) throw new Error("Betting is off for this room.");

    const match = await ctx.db
      .query("matches")
      .withIndex("by_ext", (q) => q.eq("extId", matchExtId))
      .unique();
    if (!match) throw new Error("Match not found.");
    if (!isOpen(match.status))
      throw new Error("Betting is closed for this match.");

    const ranks = ranksFor(match);
    if (!ranks) throw new Error("This match can't be priced.");

    const isKnockout = match.stage !== "GROUP_STAGE";
    if (isKnockout && pick === "DRAW")
      throw new Error("Knockout matches can't end in a draw.");

    if (!Number.isInteger(stake) || stake < 1)
      throw new Error("Stake must be a whole number of at least 1.");

    // Available excludes any existing bet on THIS match, since placing replaces
    // it (its held stake is freed back into the bankroll first).
    const myBets = await ctx.db
      .query("bets")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", room._id).eq("playerId", me._id),
      )
      .collect();
    const existing = myBets.find((b) => b.matchExtId === matchExtId);
    const others = myBets.filter((b) => b.matchExtId !== matchExtId);
    const matches = await ctx.db.query("matches").collect();
    const matchByExtId = new Map(matches.map((m) => [m.extId, m]));
    const { available } = computeBankroll(startingPot, others, matchByExtId);
    if (stake > available)
      throw new Error(
        `Stake exceeds your available bankroll (${available}).`,
      );

    const { odds } = oddsForMatch(match, ranks, isKnockout);
    const chosen = odds[pick];
    if (chosen === undefined) throw new Error("That outcome isn't available.");

    if (existing) {
      await ctx.db.patch(existing._id, {
        pick,
        stake,
        odds: chosen,
        placedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("bets", {
        roomId: room._id,
        playerId: me._id,
        userId,
        matchExtId,
        pick,
        stake,
        odds: chosen,
        placedAt: Date.now(),
      });
    }
  },
});

// Cancel the viewer's bet on a match. Refused once the match has kicked off.
export const cancelBet = mutation({
  args: { code: v.string(), matchExtId: v.number() },
  handler: async (ctx, { code, matchExtId }) => {
    const userId = await requireUser(ctx);
    const seat = await viewerSeat(ctx, code, userId);
    if (!seat) throw new Error("You're not in this game.");

    const match = await ctx.db
      .query("matches")
      .withIndex("by_ext", (q) => q.eq("extId", matchExtId))
      .unique();
    if (match && !isOpen(match.status))
      throw new Error("Betting is closed for this match.");

    const myBets = await ctx.db
      .query("bets")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", seat.room._id).eq("playerId", seat.me._id),
      )
      .collect();
    const existing = myBets.find((b) => b.matchExtId === matchExtId);
    if (existing) await ctx.db.delete(existing._id);
  },
});
