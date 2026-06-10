import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id, Doc } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  POOL,
  MAX_PLAYERS,
  REVEAL_MS,
  AFRICAN_POOL,
  ENTRY_FEE,
  RANK_BY_NAME,
  tierForRank,
} from "./pool";
import { avatarUrls } from "./account";

// Unambiguous alphabet (no 0/O/1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genCode(): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Each player ends with four teams to track: their freely-chosen African team
// plus one drawn from each tier. The African pick happens off the turn clock
// (anyone can choose it on entry - see pickAfrican), so the live draw is just
// the three tier rounds:
//   round 0 → tier 1   round 1 → tier 2   round 2 → tier 3   (random draws)
// A player's own African team is excluded from their tier draws, so the two can
// never collide (the African pick is made before the draw locks).
const ROUNDS = 3;
function totalPicks(n: number): number {
  return n * ROUNDS;
}

// Pick a random eligible team from `tier` to hand to a player. The player's own
// African pick is excluded where possible (the two can never collide), falling
// back to the full pool only if that would otherwise leave nothing. Returns
// null when the tier is exhausted. Pure over the in-memory `teams` array, so
// callers assigning many picks in one pass can mark winners as taken locally.
function pickTierTeam(
  teams: Doc<"teams">[],
  tier: number,
  ownAfrican: string | undefined,
): Doc<"teams"> | null {
  const available = teams.filter((t) => t.tier === tier && !t.ownerId);
  if (available.length === 0) return null;
  const eligible = ownAfrican
    ? available.filter((t) => t.name !== ownAfrican)
    : available;
  const pool = eligible.length > 0 ? eligible : available;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Re-seed a room's team pool to the player count: keep the top `TIERS × n`
// ranked teams, split them into equal tiers of n, and cut the rest (CUT_TIER),
// so no key team sits out simply because there are fewer than 16 players. Each
// player still draws exactly one team per tier. Persists the new tiers AND
// mutates the passed `teams` array in place, so a caller mid-allocation keeps
// using it. Run once when a draw starts (or is auto-allocated from the lobby);
// idempotent, since it always re-derives from the fixed global ranking.
async function retierForDraw(
  ctx: MutationCtx,
  teams: Doc<"teams">[],
  playerCount: number,
): Promise<void> {
  for (const t of teams) {
    const rank = RANK_BY_NAME[t.name];
    const next = rank === undefined ? t.tier : tierForRank(rank, playerCount);
    if (next !== t.tier) {
      await ctx.db.patch(t._id, { tier: next });
      t.tier = next;
    }
  }
}

// The off-clock African bonus pick must be in for every player before the draw
// can lock - otherwise finishing the last tier pick would shut out anyone still
// choosing (pickAfrican refuses once the room is "done"). The tier draw may
// complete first; the room only flips to "done" once the final African pick
// lands too (see draw / hostDraw / pickAfrican).
function allAfricanPicked(players: Doc<"players">[]): boolean {
  return players.every((p) => !!p.africanTeam);
}

// A random African nation, used when a turn is auto-resolved rather than chosen.
function randomAfrican(): { name: string; flag: string } {
  const c = AFRICAN_POOL[Math.floor(Math.random() * AFRICAN_POOL.length)];
  return { name: c.name, flag: c.flag };
}

// Snake order: even rounds forward, odd rounds reverse. Maps a pick index to
// the player on the clock and the tier of the pot. Rounds 0-2 draw tiers 1-3.
function whoseTurn(turnOrder: Id<"players">[], pickIndex: number) {
  const n = turnOrder.length;
  const round = Math.floor(pickIndex / n);
  const pos = pickIndex % n;
  const idx = round % 2 === 0 ? pos : n - 1 - pos;
  return { playerId: turnOrder[idx], tier: round + 1, round };
}

// Identity is always derived server-side from the signed-in session - never
// trusted from a client argument.
async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in to play.");
  return userId;
}

async function displayName(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<string> {
  const user = await ctx.db.get(userId);
  return (user?.name ?? "").trim() || "Player";
}

// The games the signed-in account belongs to - and only those.
export const myGames = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const seats = await ctx.db
      .query("players")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(100);

    const games = [];
    for (const seat of seats) {
      const room = await ctx.db.get(seat.roomId);
      if (!room) continue;
      const players = await ctx.db
        .query("players")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .collect();
      games.push({
        code: room.code,
        name: room.name,
        status: room.status,
        playerCount: players.length,
        isHost: room.hostId === userId,
        joinedAt: seat.joinedAt,
      });
    }
    games.sort((a, b) => b.joinedAt - a.joinedAt);
    return games;
  },
});

export const getRoom = query({
  args: { code: v.optional(v.string()) },
  handler: async (ctx, { code }) => {
    if (!code) return null;
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) return null;

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    players.sort((a, b) => a.joinedAt - b.joinedAt);

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    let current = null as null | {
      playerId: Id<"players">;
      tier: number;
    };
    if (
      room.status === "drawing" &&
      room.turnOrder.length > 0 &&
      room.pickIndex < totalPicks(room.turnOrder.length)
    ) {
      const w = whoseTurn(room.turnOrder, room.pickIndex);
      current = { playerId: w.playerId, tier: w.tier };
    }

    const me = players.find((p) => p.userId === userId);

    // Attach each seat's profile picture (resolved from its account).
    const avatars = await avatarUrls(
      ctx,
      players.map((p) => p.userId),
    );
    const playersWithAvatars = players.map((p) => ({
      ...p,
      avatarUrl: avatars[p.userId] ?? null,
    }));

    return {
      room,
      players: playersWithAvatars,
      teams,
      current,
      viewerId: userId,
      isMember: !!me,
    };
  },
});

export const createRoom = mutation({
  args: { name: v.string(), entryFee: v.optional(v.number()) },
  handler: async (ctx, { name, entryFee }) => {
    const userId = await requireUser(ctx);

    // Clamp the buy-in to a sane whole-Rand amount; fall back to the default.
    const fee =
      entryFee == null || !Number.isFinite(entryFee)
        ? ENTRY_FEE
        : Math.min(100000, Math.max(0, Math.round(entryFee)));

    let code = "";
    for (let i = 0; i < 12; i++) {
      const candidate = genCode();
      const clash = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", candidate))
        .unique();
      if (!clash) {
        code = candidate;
        break;
      }
    }
    if (!code) throw new Error("Could not allocate a room code, try again.");

    const roomId = await ctx.db.insert("rooms", {
      name: name.trim() || "Untitled draw",
      code,
      status: "lobby",
      hostId: userId,
      entryFee: fee,
      turnOrder: [],
      pickIndex: 0,
    });

    await ctx.db.insert("players", {
      roomId,
      userId,
      name: await displayName(ctx, userId),
      joinedAt: Date.now(),
    });

    for (const t of POOL) {
      await ctx.db.insert("teams", {
        roomId,
        name: t.name,
        flag: t.flag,
        tier: t.tier,
      });
    }

    return { code };
  },
});

export const joinRoom = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);

    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code.toUpperCase().trim()))
      .unique();
    if (!room) throw new Error("Room not found - check the code.");

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    const existing = players.find((p) => p.userId === userId);
    if (existing) return { code: room.code };

    if (room.status !== "lobby")
      throw new Error("That game has already started.");
    if (players.length >= MAX_PLAYERS)
      throw new Error(`Room is full (${MAX_PLAYERS} max).`);

    await ctx.db.insert("players", {
      roomId: room._id,
      userId,
      name: await displayName(ctx, userId),
      joinedAt: Date.now(),
    });

    return { code: room.code };
  },
});

export const startGame = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can start the game.");
    if (room.status !== "lobby") throw new Error("Game already started.");

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    if (players.length < 2)
      throw new Error("Need at least 2 players to start.");
    players.sort((a, b) => a.joinedAt - b.joinedAt);

    const turnOrder = shuffle(players.map((p) => p._id));

    // Trim & re-seed the field to this player count before the draw opens, so
    // every tier holds exactly as many teams as there are players.
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    await retierForDraw(ctx, teams, players.length);

    await ctx.db.patch(room._id, {
      status: "drawing",
      turnOrder,
      pickIndex: 0,
    });
  },
});

export const draw = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.status !== "drawing") throw new Error("The draw is not running.");

    const total = totalPicks(room.turnOrder.length);
    if (room.pickIndex >= total) throw new Error("The draw is complete.");

    const { playerId, tier } = whoseTurn(room.turnOrder, room.pickIndex);
    const current = await ctx.db.get(playerId);
    if (!current) throw new Error("Player not found.");
    if (current.userId !== userId) throw new Error("It's not your turn.");

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    // Block a new pick while the previous reveal is still animating.
    const now = Date.now();
    const stillRevealing = teams.some(
      (t) => t.assignedAt && now < t.assignedAt + REVEAL_MS,
    );
    if (stillRevealing) throw new Error("Hold on - a team is being revealed.");

    const pick = pickTierTeam(teams, tier, current.africanTeam?.name);
    if (!pick) throw new Error("No teams left in this tier.");
    await ctx.db.patch(pick._id, { ownerId: playerId, assignedAt: now });

    const nextIndex = room.pickIndex + 1;
    // Lock only once the tier picks are done AND every player has made their
    // off-clock African bonus pick - never strand a straggler still choosing.
    // Until then the room stays "drawing" with the tier draw finished; the last
    // African pick flips it to "done" (see pickAfrican).
    let done = false;
    if (nextIndex >= total) {
      const allPlayers = await ctx.db
        .query("players")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .collect();
      done = allAfricanPicked(allPlayers);
    }
    await ctx.db.patch(room._id, {
      pickIndex: nextIndex,
      status: done ? "done" : "drawing",
    });
  },
});

// The bonus pick: every player freely chooses an African nation for themselves.
// This is off the turn clock - anyone can pick (or change their pick) the moment
// they're in the room, right up until the draw locks. Duplicates across players
// are fine. A player can't pick a nation they've already drawn from a tier, so
// their African team and tier teams never collide.
export const pickAfrican = mutation({
  args: { code: v.string(), teamName: v.string() },
  handler: async (ctx, { code, teamName }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.status === "done") throw new Error("The draw is already locked.");

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    const me = players.find((p) => p.userId === userId);
    if (!me) throw new Error("You're not in this game.");

    const choice = AFRICAN_POOL.find((t) => t.name === teamName);
    if (!choice) throw new Error("Pick one of the African teams.");

    // Don't let the bonus pick duplicate a team this player already drew.
    const drawn = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    if (drawn.some((t) => t.ownerId === me._id && t.name === choice.name))
      throw new Error("You already drew that team - pick a different one.");

    await ctx.db.patch(me._id, {
      africanTeam: { name: choice.name, flag: choice.flag },
    });

    // If the tier draw already finished and this was the last outstanding
    // African pick, the draw is now fully settled - lock it.
    const total = totalPicks(room.turnOrder.length);
    if (
      room.status === "drawing" &&
      room.pickIndex >= total &&
      players.every((p) => p._id === me._id || !!p.africanTeam)
    ) {
      await ctx.db.patch(room._id, { status: "done" });
    }
  },
});

// The host can resolve the current player's turn for them, so a slow or absent
// player never stalls the draw. Draws a random team for the seat on the clock,
// exactly as that player's own tap would. (The African bonus is chosen off the
// clock, so it isn't part of a turn.)
export const hostDraw = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can draw for a player.");
    if (room.status !== "drawing") throw new Error("The draw is not running.");

    const total = totalPicks(room.turnOrder.length);
    if (room.pickIndex >= total) throw new Error("The draw is complete.");

    const { playerId, tier } = whoseTurn(room.turnOrder, room.pickIndex);
    const current = await ctx.db.get(playerId);
    if (!current) throw new Error("Player not found.");

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    // Block while the previous reveal is still animating, same as a self-draw.
    const now = Date.now();
    const stillRevealing = teams.some(
      (t) => t.assignedAt && now < t.assignedAt + REVEAL_MS,
    );
    if (stillRevealing) throw new Error("Hold on - a team is being revealed.");

    const pick = pickTierTeam(teams, tier, current.africanTeam?.name);
    if (!pick) throw new Error("No teams left in this tier.");
    await ctx.db.patch(pick._id, { ownerId: playerId, assignedAt: now });

    const nextIndex = room.pickIndex + 1;
    // Lock only once the tier picks are done AND every player has made their
    // off-clock African bonus pick - never strand a straggler still choosing.
    // Until then the room stays "drawing" with the tier draw finished; the last
    // African pick flips it to "done" (see pickAfrican).
    let done = false;
    if (nextIndex >= total) {
      const allPlayers = await ctx.db
        .query("players")
        .withIndex("by_room", (q) => q.eq("roomId", room._id))
        .collect();
      done = allAfricanPicked(allPlayers);
    }
    await ctx.db.patch(room._id, {
      pickIndex: nextIndex,
      status: done ? "done" : "drawing",
    });
  },
});

// Skip the live draw entirely: the host assigns every remaining pick at once -
// random tier teams and a random African nation for anyone who hasn't chosen -
// and the draw jumps straight to done. Works from the lobby (allocate the whole
// field) or mid-draw (finish whatever's left). No reveal animation: results
// simply appear, since the point is to settle everyone immediately.
export const autoAllocate = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can auto-allocate.");
    if (room.status === "done") throw new Error("The draw is already complete.");

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    if (players.length < 2)
      throw new Error("Need at least 2 players to allocate.");
    players.sort((a, b) => a.joinedAt - b.joinedAt);

    // From the lobby we first need a turn order, exactly like startGame; from a
    // running draw we keep the order and resume from the current pick.
    const fromLobby = room.status === "lobby";
    const turnOrder = fromLobby ? shuffle(players.map((p) => p._id)) : room.turnOrder;
    const startIndex = fromLobby ? 0 : room.pickIndex;
    const total = totalPicks(turnOrder.length);

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    // From the lobby, trim & re-seed the field to the player count first (the
    // live draw does this in startGame). Mid-draw the tiers are already set.
    if (fromLobby) await retierForDraw(ctx, teams, players.length);

    // Give a random African nation to anyone who never chose one, then track
    // every seat's pick so tier draws can exclude it (the two never collide).
    const africanName = new Map<Id<"players">, string | undefined>();
    for (const p of players) {
      if (p.africanTeam) {
        africanName.set(p._id, p.africanTeam.name);
      } else {
        const choice = randomAfrican();
        await ctx.db.patch(p._id, { africanTeam: choice });
        africanName.set(p._id, choice.name);
      }
    }

    for (let i = startIndex; i < total; i++) {
      const { playerId, tier } = whoseTurn(turnOrder, i);
      const pick = pickTierTeam(teams, tier, africanName.get(playerId));
      if (pick) {
        await ctx.db.patch(pick._id, { ownerId: playerId });
        pick.ownerId = playerId; // mark taken for the rest of this pass
      }
    }

    await ctx.db.patch(room._id, {
      status: "done",
      turnOrder,
      pickIndex: total,
    });
  },
});

// Permanently delete a game - only the host can do this. Removes the room and
// everything scoped to it (player seats and the team pool). Shared data
// (matches, group standings) is untouched.
export const deleteRoom = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can delete the game.");

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const t of teams) await ctx.db.delete(t._id);

    const roomPlayers = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const p of roomPlayers) await ctx.db.delete(p._id);

    await ctx.db.delete(room._id);
  },
});

// Optional: wipe a room back to the lobby so the same group can re-draw.
export const resetRoom = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can reset the draw.");

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const t of teams) {
      await ctx.db.patch(t._id, { ownerId: undefined, assignedAt: undefined });
    }
    const roomPlayers = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const p of roomPlayers) {
      if (p.africanTeam) await ctx.db.patch(p._id, { africanTeam: undefined });
    }
    await ctx.db.patch(room._id, {
      status: "lobby",
      turnOrder: [],
      pickIndex: 0,
    });
  },
});
