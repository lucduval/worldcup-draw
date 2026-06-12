import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

const MAX_NAME = 18;

// Resolve profile-picture URLs for a set of users in one pass. Storage URLs
// are signed, so they're computed at read time rather than denormalised onto
// each game seat - that keeps avatars consistent everywhere automatically.
export async function avatarUrls(
  ctx: QueryCtx | MutationCtx,
  userIds: Id<"users">[],
): Promise<Record<Id<"users">, string | null>> {
  const map: Record<Id<"users">, string | null> = {};
  for (const userId of userIds) {
    if (userId in map) continue; // dedupe repeated owners
    const user = await ctx.db.get(userId);
    map[userId] = user?.imageId ? await ctx.storage.getUrl(user.imageId) : null;
  }
  return map;
}

// The signed-in account's own profile, for the My Account screen and header.
export const me = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return {
      name: (user.name ?? "").trim() || "Player",
      email: user.email ?? null,
      imageUrl: user.imageId ? await ctx.storage.getUrl(user.imageId) : null,
      // `undefined` (existing accounts) reads as not-yet-seen so the one-time
      // walkthrough still shows them the guide once.
      seenIntro: user.seenIntro ?? false,
    };
  },
});

// Mark the first-login walkthrough as seen for the signed-in account, so it
// never auto-opens again. Idempotent - safe to call when already seen (e.g.
// when an invited player is routed straight into a room).
export const markIntroSeen = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null; // not signed in yet - nothing to mark
    await ctx.db.patch(userId, { seenIntro: true });
    return null;
  },
});

// Hand the client a one-time URL to POST a new profile picture to. The client
// then calls `updateProfile` with the returned storage id.
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    return await ctx.storage.generateUploadUrl();
  },
});

// Update the signed-in account's name and/or picture. A name change is
// propagated to every game seat this account holds, so it reads consistently
// across past and present draws.
export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    imageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { name, imageId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Account not found.");

    const patch: { name?: string; imageId?: Id<"_storage"> } = {};

    if (name !== undefined) {
      const clean = name.trim();
      if (!clean) throw new Error("Pop your name in first.");
      if (clean.length > MAX_NAME)
        throw new Error(`Keep your name under ${MAX_NAME} characters.`);
      patch.name = clean;
    }

    if (imageId !== undefined) {
      // Drop the previous picture so storage doesn't accumulate orphans.
      if (user.imageId && user.imageId !== imageId) {
        await ctx.storage.delete(user.imageId);
      }
      patch.imageId = imageId;
    }

    await ctx.db.patch(userId, patch);

    if (patch.name !== undefined) {
      const seats = await ctx.db
        .query("players")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(200);
      for (const seat of seats) {
        if (seat.name !== patch.name)
          await ctx.db.patch(seat._id, { name: patch.name });
      }
    }

    return null;
  },
});
