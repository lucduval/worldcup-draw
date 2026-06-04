import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";
import { POOL, MAX_PLAYERS, TIERS, REVEAL_MS } from "./pool";

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

// Snake order: round 0 forward, round 1 reverse, round 2 forward...
// Each round draws from one tier (round + 1).
function whoseTurn(turnOrder: Id<"players">[], pickIndex: number) {
  const n = turnOrder.length;
  const round = Math.floor(pickIndex / n);
  const pos = pickIndex % n;
  const idx = round % 2 === 0 ? pos : n - 1 - pos;
  return { playerId: turnOrder[idx], tier: round + 1, round };
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

    let current = null as null | { playerId: Id<"players">; tier: number };
    if (room.status === "drawing" && room.turnOrder.length > 0) {
      const w = whoseTurn(room.turnOrder, room.pickIndex);
      current = { playerId: w.playerId, tier: w.tier };
    }

    const me = players.find((p) => p.userId === userId);
    return { room, players, teams, current, viewerId: userId, isMember: !!me };
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

    const total = room.turnOrder.length * TIERS;
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
    if (stillRevealing) throw new Error("Hold on — a team is being revealed.");

    const available = teams.filter((t) => t.tier === tier && !t.ownerId);
    if (available.length === 0)
      throw new Error("No teams left in this tier.");

    const pick = available[Math.floor(Math.random() * available.length)];
    await ctx.db.patch(pick._id, { ownerId: playerId, assignedAt: now });

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
    await ctx.db.patch(room._id, {
      status: "lobby",
      turnOrder: [],
      pickIndex: 0,
    });
  },
});
