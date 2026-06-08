import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { POOL, MAX_PLAYERS, REVEAL_MS, AFRICAN_POOL } from "./pool";
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

// Each player ends with four teams to track: their chosen African team plus one
// drawn from each tier. The rounds run in this fixed order:
//   round 0 → African bonus (a free choice)
//   round 1 → tier 1   round 2 → tier 2   round 3 → tier 3   (random draws)
// African is picked FIRST so a player's own African team can be excluded from
// their later draws — the two can never collide.
const ROUNDS = 4;
function totalPicks(n: number): number {
  return n * ROUNDS;
}

// Snake order: even rounds forward, odd rounds reverse. Maps a pick index to
// the player on the clock, the tier of the pot, and the phase.
function whoseTurn(turnOrder: Id<"players">[], pickIndex: number) {
  const n = turnOrder.length;
  const round = Math.floor(pickIndex / n);
  const pos = pickIndex % n;
  const idx = round % 2 === 0 ? pos : n - 1 - pos;

  // round 0 is the African choice; rounds 1-3 draw from tiers 1-3.
  const phase: "draw" | "african" = round === 0 ? "african" : "draw";
  const tier = round === 0 ? 0 : round;
  return { playerId: turnOrder[idx], tier, phase, round };
}

// Identity is always derived server-side from the signed-in session — never
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

// The games the signed-in account belongs to — and only those.
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
      phase: "draw" | "african";
    };
    if (room.status === "drawing" && room.turnOrder.length > 0) {
      const w = whoseTurn(room.turnOrder, room.pickIndex);
      current = { playerId: w.playerId, tier: w.tier, phase: w.phase };
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
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await requireUser(ctx);

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
    if (!room) throw new Error("Room not found — check the code.");

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

    const { playerId, tier, phase } = whoseTurn(room.turnOrder, room.pickIndex);
    if (phase === "african")
      throw new Error("Pick your African team for the bonus round.");
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
    if (stillRevealing) throw new Error("Hold on — a team is being revealed.");

    const available = teams.filter((t) => t.tier === tier && !t.ownerId);
    if (available.length === 0)
      throw new Error("No teams left in this tier.");

    // A player can never draw the African team they chose in round 0. Exclude
    // it from their pool — unless it's somehow the only team left in the tier,
    // in which case we fall back to the full pool rather than stall the draw.
    const ownAfrican = current.africanTeam?.name;
    const eligible = ownAfrican
      ? available.filter((t) => t.name !== ownAfrican)
      : available;
    const pool = eligible.length > 0 ? eligible : available;

    const pick = pool[Math.floor(Math.random() * pool.length)];
    await ctx.db.patch(pick._id, { ownerId: playerId, assignedAt: now });

    const nextIndex = room.pickIndex + 1;
    await ctx.db.patch(room._id, {
      pickIndex: nextIndex,
      status: nextIndex >= total ? "done" : "drawing",
    });
  },
});

// The bonus round: the player on the clock chooses an African nation. Unlike
// the main draw this is a free choice, and duplicates across players are fine.
export const pickAfrican = mutation({
  args: { code: v.string(), teamName: v.string() },
  handler: async (ctx, { code, teamName }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.status !== "drawing") throw new Error("The draw is not running.");

    const total = totalPicks(room.turnOrder.length);
    if (room.pickIndex >= total) throw new Error("The draw is complete.");

    const { playerId, phase } = whoseTurn(room.turnOrder, room.pickIndex);
    if (phase !== "african")
      throw new Error("The African bonus round hasn't started yet.");
    const current = await ctx.db.get(playerId);
    if (!current) throw new Error("Player not found.");
    if (current.userId !== userId) throw new Error("It's not your turn.");

    const choice = AFRICAN_POOL.find((t) => t.name === teamName);
    if (!choice) throw new Error("Pick one of the African teams.");

    await ctx.db.patch(playerId, {
      africanTeam: { name: choice.name, flag: choice.flag },
    });

    const nextIndex = room.pickIndex + 1;
    await ctx.db.patch(room._id, {
      pickIndex: nextIndex,
      status: nextIndex >= total ? "done" : "drawing",
    });
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
