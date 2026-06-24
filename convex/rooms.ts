import {
  mutation,
  query,
  internalMutation,
  QueryCtx,
  MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { Id, Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  POOL,
  MAX_PLAYERS,
  REVEAL_MS,
  AFRICAN_POOL,
  ENTRY_FEE,
  TIMER_PRESETS,
  DEFAULT_TIMER_SECONDS,
  RANK_BY_NAME,
  tierForRank,
  clampStartingPot,
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
// Avoids any nation in `exclude` (e.g. teams the player already drew from a
// tier) where possible, falling back to the full pool only if that would leave
// nothing - so a forced pick never duplicates a player's own drawn team.
function randomAfrican(exclude?: Set<string>): { name: string; flag: string } {
  const eligible =
    exclude && exclude.size > 0
      ? AFRICAN_POOL.filter((t) => !exclude.has(t.name))
      : AFRICAN_POOL;
  const pool = eligible.length > 0 ? eligible : AFRICAN_POOL;
  const c = pool[Math.floor(Math.random() * pool.length)];
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

// ── Live turn timer ────────────────────────────────────────────────────────
// When the host has the timer on, every turn is given a deadline; if the player
// on the clock hasn't drawn by then, the server resolves the turn for them (see
// resolveTimeout). These helpers compute the room patch fields that arm or
// clear the timer, and schedule/cancel the backing auto-pick job.

// Compute the {turnDeadline, timerJobId} patch for the turn at `pickIndex`.
// Returns both cleared (undefined) when the timer is off, the draw isn't
// running, or there's no active turn left. `afterReveal` pads the deadline by
// the reveal animation, so a player gets their full `seconds` to actually tap
// once the previous pick has finished revealing.
async function armTimerPatch(
  ctx: MutationCtx,
  roomId: Id<"rooms">,
  opts: {
    pickIndex: number;
    total: number;
    status: "lobby" | "drawing" | "done";
    enabled: boolean;
    seconds: number;
    now: number;
    afterReveal: boolean;
  },
): Promise<{ turnDeadline?: number; timerJobId?: Id<"_scheduled_functions"> }> {
  const { pickIndex, total, status, enabled, seconds, now, afterReveal } = opts;
  if (!enabled || status !== "drawing" || pickIndex >= total) {
    return { turnDeadline: undefined, timerJobId: undefined };
  }
  const turnDeadline = now + (afterReveal ? REVEAL_MS : 0) + seconds * 1000;
  const timerJobId = await ctx.scheduler.runAt(
    turnDeadline,
    internal.rooms.resolveTimeout,
    { roomId, forPickIndex: pickIndex },
  );
  return { turnDeadline, timerJobId };
}

// Resolve the turn currently on the clock: draw a random in-tier team for the
// player on it (excluding their own African pick, exactly as a manual tap),
// advance the pick index, lock the room if the tier draw + every African pick
// are in, and arm the timer for the next turn. Shared by the manual draw, the
// host's draw-for-a-player, and the auto-pick when a turn times out. Pass
// `guardReveal` to refuse while the previous reveal is still animating (manual
// taps want this; the timer auto-pick never collides with a reveal).
async function resolveCurrentTurn(
  ctx: MutationCtx,
  room: Doc<"rooms">,
  now: number,
  guardReveal: boolean,
): Promise<void> {
  const { playerId, tier } = whoseTurn(room.turnOrder, room.pickIndex);
  const current = await ctx.db.get(playerId);
  if (!current) throw new Error("Player not found.");

  const teams = await ctx.db
    .query("teams")
    .withIndex("by_room", (q) => q.eq("roomId", room._id))
    .collect();

  if (guardReveal) {
    const stillRevealing = teams.some(
      (t) => t.assignedAt && now < t.assignedAt + REVEAL_MS,
    );
    if (stillRevealing) throw new Error("Hold on - a team is being revealed.");
  }

  const pick = pickTierTeam(teams, tier, current.africanTeam?.name);
  if (!pick) throw new Error("No teams left in this tier.");
  await ctx.db.patch(pick._id, { ownerId: playerId, assignedAt: now });

  const total = totalPicks(room.turnOrder.length);
  const nextIndex = room.pickIndex + 1;
  // Lock only once the tier picks are done AND every player has made their
  // off-clock African bonus pick - never strand a straggler still choosing.
  let done = false;
  if (nextIndex >= total) {
    const allPlayers = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    done = allAfricanPicked(allPlayers);
  }
  const status: "drawing" | "done" = done ? "done" : "drawing";

  // The job for the turn we just resolved is spent - cancel it (a no-op when
  // it's the running timeout job itself) before arming the next turn's clock.
  if (room.timerJobId) await ctx.scheduler.cancel(room.timerJobId);
  const timer = await armTimerPatch(ctx, room._id, {
    pickIndex: nextIndex,
    total,
    status,
    enabled: room.timerEnabled ?? false,
    seconds: room.timerSeconds ?? DEFAULT_TIMER_SECONDS,
    now,
    afterReveal: true,
  });

  await ctx.db.patch(room._id, { pickIndex: nextIndex, status, ...timer });
}

// Reconstruct the async draw as an ordered playback script the client animates:
// one entry per tier pick, in real pick order. Each player owns exactly one team
// per tier, so whoseTurn + ownerId/tier uniquely identifies what they drew. The
// watcher's own teams ride along here and are only surfaced as they tap.
function buildScript(turnOrder: Id<"players">[], teams: Doc<"teams">[]) {
  const total = totalPicks(turnOrder.length);
  const script = [];
  for (let i = 0; i < total; i++) {
    const { playerId, tier } = whoseTurn(turnOrder, i);
    const team = teams.find((t) => t.ownerId === playerId && t.tier === tier);
    if (!team) continue;
    script.push({
      pickIndex: i,
      playerId,
      tier,
      teamId: team._id,
      teamName: team.name,
      flag: team.flag,
    });
  }
  return script;
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
      // Async "action needed" reminder: this player still owes an African pick
      // (only possible while the draw is open) or hasn't watched their replay.
      const mode = room.mode === "async" ? "async" : "live";
      const needsAfrican =
        mode === "async" && room.status === "drawing" && !seat.africanTeam;
      const needsWatch =
        mode === "async" && room.status !== "lobby" && !seat.watchedAt;
      games.push({
        code: room.code,
        name: room.name,
        status: room.status,
        mode,
        playerCount: players.length,
        isHost: room.hostId === userId,
        joinedAt: seat.joinedAt,
        needsAction: needsAfrican || needsWatch,
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

    // Async spoiler gating: once the draw has run, a player who hasn't watched
    // their walk-through yet gets the result only as a playback script (which
    // their replay client animates), and the static board is stripped of owners
    // so it can't be peeked. Everyone else (live mode, or already-watched) sees
    // the board as normal. The script always carries the watcher's own teams -
    // they're revealed in the UI only as they tap - which is the pragmatic
    // trade-off for a casual friends' game.
    const isAsync = room.mode === "async";
    const needsWatch =
      isAsync && room.status !== "lobby" && !!me && !me.watchedAt;
    const script = needsWatch ? buildScript(room.turnOrder, teams) : null;
    const outTeams = needsWatch
      ? teams.map((t) => ({ ...t, ownerId: undefined, assignedAt: undefined }))
      : teams;

    return {
      room,
      players: playersWithAvatars,
      teams: outTeams,
      current,
      viewerId: userId,
      isMember: !!me,
      needsWatch,
      script,
    };
  },
});

export const createRoom = mutation({
  args: {
    name: v.string(),
    entryFee: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("live"), v.literal("async"))),
    startingPot: v.optional(v.number()),
    // Coin re-buy cap; defaults to "off" so a new room never silently gains
    // real-money re-buys. Editable later via setPurchaseCap.
    purchaseCap: v.optional(
      v.union(v.literal("off"), v.literal("unlimited"), v.number()),
    ),
  },
  handler: async (ctx, { name, entryFee, mode, startingPot, purchaseCap }) => {
    const userId = await requireUser(ctx);

    // Clamp the buy-in to a sane whole-Rand amount; fall back to the default.
    const fee =
      entryFee == null || !Number.isFinite(entryFee)
        ? ENTRY_FEE
        : Math.min(100000, Math.max(0, Math.round(entryFee)));

    // Per-player betting bankroll; defaults to STARTING_POT_DEFAULT, 0 = off.
    const pot = clampStartingPot(startingPot);

    // Coin re-buy cap: undefined/"off" ⇒ Off (the default), "unlimited" ⇒ no
    // ceiling, a positive number ⇒ that per-player ceiling.
    const capUnlimited = purchaseCap === "unlimited";
    const capNumber =
      typeof purchaseCap === "number" && purchaseCap >= 1
        ? Math.round(purchaseCap)
        : undefined;

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
      mode: mode === "async" ? "async" : "live",
      entryFee: fee,
      startingPot: pot,
      purchaseUnlimited: capUnlimited,
      purchaseCap: capNumber,
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

// The host can switch a room between live and watch-anytime while it's still in
// the lobby - the call to make once everyone's gathered, before the draw runs.
export const setMode = mutation({
  args: {
    code: v.string(),
    mode: v.union(v.literal("live"), v.literal("async")),
  },
  handler: async (ctx, { code, mode }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can change the draw style.");
    if (room.status !== "lobby")
      throw new Error("The draw has already started.");
    if ((room.mode ?? "live") !== mode) await ctx.db.patch(room._id, { mode });
  },
});

// The betting pot is frozen the moment the first bet is placed - changing it
// after that would retroactively shift every player's bankroll baseline. Before
// then it's freely editable (lobby, or a `done` room with no bets yet), which is
// what lets an in-progress game opt into betting mid-tournament. Kickoff itself
// is irrelevant: only upcoming SCHEDULED/TIMED fixtures are ever bettable (see
// betting.ts `isOpen`), so enabling betting late can't touch a known result.
async function roomHasBets(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
): Promise<boolean> {
  const first = await ctx.db
    .query("bets")
    .withIndex("by_room", (q) => q.eq("roomId", roomId))
    .first();
  return first !== null;
}

// Exposed so the host's pot control can disable itself once the pot is locked,
// instead of letting the host change it and fail on submit.
export const potLocked = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) return false;
    return roomHasBets(ctx, room._id);
  },
});

// Host sets the per-player betting bankroll (0 = betting off). Editable in the
// lobby, OR on an already-drawn (`done`) room until the first bet is placed - so
// an existing game can opt into betting at any point, including mid-tournament
// (players then back the remaining fixtures). Refused during the draw, and
// locked for good once any bet exists, which freezes everyone's bankroll
// baseline.
export const setPot = mutation({
  args: { code: v.string(), startingPot: v.number() },
  handler: async (ctx, { code, startingPot }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can change the betting pot.");
    if (room.status === "drawing")
      throw new Error("Finish the draw before changing the betting pot.");

    // Locked once any bet exists; harmless to re-baseline before then.
    if (await roomHasBets(ctx, room._id))
      throw new Error("Players have already placed bets - the pot is locked.");

    await ctx.db.patch(room._id, { startingPot: clampStartingPot(startingPot) });
  },
});

// Host sets the per-player coin re-buy cap: "off", "unlimited", or a whole
// number ceiling on cumulative purchased coins (see pool.ts `purchaseCapOf`).
// Unlike the betting pot, the cap is NOT locked by the existence of bets — the
// host can loosen or tighten it any time the room isn't mid-draw. The one guard:
// a numeric cap may not be set below what some player has ALREADY bought, so the
// cap can never retroactively invalidate a purchase. Independent of startingPot.
export const setPurchaseCap = mutation({
  args: {
    code: v.string(),
    cap: v.union(v.literal("off"), v.literal("unlimited"), v.number()),
  },
  handler: async (ctx, { code, cap }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can change the coin cap.");
    if (room.status === "drawing")
      throw new Error("Finish the draw before changing the coin cap.");

    if (cap === "off") {
      await ctx.db.patch(room._id, {
        purchaseUnlimited: false,
        purchaseCap: undefined,
      });
      return;
    }
    if (cap === "unlimited") {
      await ctx.db.patch(room._id, {
        purchaseUnlimited: true,
        purchaseCap: undefined,
      });
      return;
    }

    // Numeric cap: whole number ≥ 1, and never below the most anyone has bought.
    const want = Math.max(1, Math.round(cap));
    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    const maxBought = players.reduce(
      (m, p) => Math.max(m, p.purchasedCoins ?? 0),
      0,
    );
    if (want < maxBought)
      throw new Error(
        `Someone has already bought ${maxBought} coins — the cap can't be lower than that.`,
      );
    await ctx.db.patch(room._id, {
      purchaseUnlimited: false,
      purchaseCap: want,
    });
  },
});

// Host toggles the live-draw turn timer (and picks its length). Works in the
// lobby AND mid-draw. Turning it on mid-draw starts the clock on the current
// turn straight away; turning it off cancels the pending auto-pick. A length
// change while it's already running takes effect from the next turn, so nobody
// loses time mid-turn. The length must be one of the offered presets.
export const setTimer = mutation({
  args: {
    code: v.string(),
    enabled: v.boolean(),
    seconds: v.optional(v.number()),
  },
  handler: async (ctx, { code, enabled, seconds }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can change the timer.");
    if (room.mode === "async")
      throw new Error("The turn timer is for live draws only.");
    if (room.status === "done")
      throw new Error("The draw is already locked.");

    // Clamp the length to a known preset; otherwise keep the current/default.
    const secs =
      seconds != null && (TIMER_PRESETS as readonly number[]).includes(seconds)
        ? seconds
        : room.timerSeconds ?? DEFAULT_TIMER_SECONDS;

    const wasEnabled = room.timerEnabled ?? false;
    const patch: Record<string, unknown> = {
      timerEnabled: enabled,
      timerSeconds: secs,
    };

    // Mid-draw transitions touch the live clock; the lobby just stores the
    // setting (startGame arms the first turn from it).
    if (room.status === "drawing") {
      const total = totalPicks(room.turnOrder.length);
      const hasActiveTurn = room.pickIndex < total;
      if (!enabled) {
        if (room.timerJobId) await ctx.scheduler.cancel(room.timerJobId);
        patch.timerJobId = undefined;
        patch.turnDeadline = undefined;
      } else if (!wasEnabled && hasActiveTurn) {
        if (room.timerJobId) await ctx.scheduler.cancel(room.timerJobId);
        const timer = await armTimerPatch(ctx, room._id, {
          pickIndex: room.pickIndex,
          total,
          status: "drawing",
          enabled: true,
          seconds: secs,
          now: Date.now(),
          afterReveal: false,
        });
        Object.assign(patch, timer);
      }
      // Already-on and staying on: leave the current deadline/job in place; the
      // new length applies when the next turn arms.
    }

    await ctx.db.patch(room._id, patch);
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
    if (room.mode === "async")
      throw new Error("This is a watch-anytime draw - use “Run the draw now”.");
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

    // Arm the turn timer for the opening pick if the host left it on.
    const timer = await armTimerPatch(ctx, room._id, {
      pickIndex: 0,
      total: totalPicks(turnOrder.length),
      status: "drawing",
      enabled: room.timerEnabled ?? false,
      seconds: room.timerSeconds ?? DEFAULT_TIMER_SECONDS,
      now: Date.now(),
      afterReveal: false,
    });

    await ctx.db.patch(room._id, {
      status: "drawing",
      turnOrder,
      pickIndex: 0,
      ...timer,
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
    if (room.mode === "async")
      throw new Error("This is a watch-anytime draw - just watch your replay.");
    if (room.status !== "drawing") throw new Error("The draw is not running.");

    const total = totalPicks(room.turnOrder.length);
    if (room.pickIndex >= total) throw new Error("The draw is complete.");

    const { playerId } = whoseTurn(room.turnOrder, room.pickIndex);
    const current = await ctx.db.get(playerId);
    if (!current) throw new Error("Player not found.");
    if (current.userId !== userId) throw new Error("It's not your turn.");

    await resolveCurrentTurn(ctx, room, Date.now(), true);
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
    if (room.mode === "async")
      throw new Error("This is a watch-anytime draw - no live turns to draw.");
    if (room.status !== "drawing") throw new Error("The draw is not running.");

    const total = totalPicks(room.turnOrder.length);
    if (room.pickIndex >= total) throw new Error("The draw is complete.");

    await resolveCurrentTurn(ctx, room, Date.now(), true);
  },
});

// Auto-pick when a turn's timer runs out. Scheduled per turn by armTimerPatch;
// fires even if every tab is closed, so a slow or absent player never stalls a
// timed draw. Guards make it a no-op if the turn already advanced (a manual tap
// beat the clock), the timer was switched off, or the draw moved on - the
// stamped `forPickIndex` is what ties this job to the turn it was armed for.
export const resolveTimeout = internalMutation({
  args: { roomId: v.id("rooms"), forPickIndex: v.number() },
  handler: async (ctx, { roomId, forPickIndex }) => {
    const room = await ctx.db.get(roomId);
    if (!room) return;
    if (room.status !== "drawing") return;
    if (!room.timerEnabled) return;
    const total = totalPicks(room.turnOrder.length);
    if (room.pickIndex !== forPickIndex || room.pickIndex >= total) return;

    await resolveCurrentTurn(ctx, room, Date.now(), false);
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
    if (room.mode === "async")
      throw new Error("This is a watch-anytime draw - use “Force-lock” instead.");
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

    // The draw is settling instantly - kill any pending turn timer.
    if (room.timerJobId) await ctx.scheduler.cancel(room.timerJobId);
    await ctx.db.patch(room._id, {
      status: "done",
      turnOrder,
      pickIndex: total,
      timerJobId: undefined,
      turnDeadline: undefined,
    });
  },
});

// ── Async "watch anytime" draw ───────────────────────────────────────────
// Compute the whole tier draw server-side in one shot (host only), then let
// each player watch it play out on their own schedule (see the replay client).
// Like startGame + the tier half of autoAllocate, but it does NOT touch African
// picks and assigns no reveal clock (assignedAt stays unset - per-viewer reveal
// timing is purely client-side). The room only locks once every African pick is
// in (via pickAfrican) or the host force-locks the stragglers.
export const runAsyncDraw = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can run the draw.");
    if (room.mode !== "async")
      throw new Error("This isn't a watch-anytime draw.");
    if (room.status !== "lobby")
      throw new Error("The draw has already been run.");

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    if (players.length < 2)
      throw new Error("Need at least 2 players to run the draw.");
    players.sort((a, b) => a.joinedAt - b.joinedAt);

    const turnOrder = shuffle(players.map((p) => p._id));

    // Trim & re-seed the field to this player count, exactly like startGame.
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    await retierForDraw(ctx, teams, players.length);

    // Resolve every tier pick now, excluding each player's own African team if
    // they already chose one (else the picker handles collisions later). Owners
    // are set, but assignedAt is left unset - there's no global reveal clock in
    // async mode; the replay client times each reveal per viewer.
    const africanName = new Map<Id<"players">, string | undefined>();
    for (const p of players) africanName.set(p._id, p.africanTeam?.name);

    const total = totalPicks(turnOrder.length);
    for (let i = 0; i < total; i++) {
      const { playerId, tier } = whoseTurn(turnOrder, i);
      const pick = pickTierTeam(teams, tier, africanName.get(playerId));
      if (pick) {
        await ctx.db.patch(pick._id, { ownerId: playerId });
        pick.ownerId = playerId; // mark taken for the rest of this pass
      }
    }

    // The tier draw is fully resolved (pickIndex = total); playback is now a
    // client concern. Lock straight to "done" only if every African pick is
    // already in - otherwise stay "drawing" until the last pick lands.
    const done = allAfricanPicked(players);
    await ctx.db.patch(room._id, {
      status: done ? "done" : "drawing",
      turnOrder,
      pickIndex: total,
    });
  },
});

// Called by the replay client when a player finishes watching their walk-
// through. Idempotent - only stamps watchedAt the first time. Clears that
// player's spoiler gate and their "hasn't watched yet" reminder.
export const markWatched = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    const me = players.find((p) => p.userId === userId);
    if (!me) throw new Error("You're not in this game.");

    if (!me.watchedAt) await ctx.db.patch(me._id, { watchedAt: Date.now() });
  },
});

// Async-mode "stop waiting": the host assigns a random African nation to anyone
// who never chose one (avoiding their own drawn teams) and locks the draw. The
// tier picks are already assigned by runAsyncDraw, so this only fills missing
// African picks and flips the room to "done".
export const forceLockAsync = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await requireUser(ctx);
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room) throw new Error("Room not found.");
    if (room.hostId !== userId)
      throw new Error("Only the host can lock the draw.");
    if (room.mode !== "async")
      throw new Error("This isn't a watch-anytime draw.");
    if (room.status === "lobby") throw new Error("Run the draw first.");
    if (room.status === "done") throw new Error("The draw is already locked.");

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();

    for (const p of players) {
      if (p.africanTeam) continue;
      const drawn = new Set(
        teams.filter((t) => t.ownerId === p._id).map((t) => t.name),
      );
      await ctx.db.patch(p._id, { africanTeam: randomAfrican(drawn) });
    }

    await ctx.db.patch(room._id, { status: "done" });
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

    // Cancel any pending turn-timer job so it doesn't fire on a dead room.
    if (room.timerJobId) await ctx.scheduler.cancel(room.timerJobId);

    const teams = await ctx.db
      .query("teams")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const t of teams) await ctx.db.delete(t._id);

    const bets = await ctx.db
      .query("bets")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const b of bets) await ctx.db.delete(b._id);

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
    // Wipe any bets so a re-draw starts with fresh bankrolls.
    const bets = await ctx.db
      .query("bets")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const b of bets) await ctx.db.delete(b._id);
    const roomPlayers = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomId", room._id))
      .collect();
    for (const p of roomPlayers) {
      // Also wipe purchased coins so a thrown-away game leaves nobody owing cash
      // for it; their pot contribution disappears with the bets. The free
      // starting pot stays as the host configured it.
      if (p.africanTeam || p.watchedAt || p.purchasedCoins)
        await ctx.db.patch(p._id, {
          africanTeam: undefined,
          watchedAt: undefined,
          purchasedCoins: undefined,
        });
    }
    // Drop any pending turn timer; the host's on/off + length preference is
    // kept so a re-draw starts with the same timer settings.
    if (room.timerJobId) await ctx.scheduler.cancel(room.timerJobId);
    await ctx.db.patch(room._id, {
      status: "lobby",
      turnOrder: [],
      pickIndex: 0,
      timerJobId: undefined,
      turnDeadline: undefined,
    });
  },
});
