import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  // Convex Auth's built-in tables (users, sessions, etc.). `users` holds the
  // signed-in account; we reference it as the owner of rooms and players.
  ...authTables,

  rooms: defineTable({
    name: v.string(), // human label, e.g. "Friends' draw"
    code: v.string(),
    status: v.union(
      v.literal("lobby"),
      v.literal("drawing"),
      v.literal("done"),
    ),
    hostId: v.id("users"), // the account that created the game
    turnOrder: v.array(v.id("players")), // set when the game starts
    pickIndex: v.number(), // how many picks have been made
  }).index("by_code", ["code"]),

  players: defineTable({
    roomId: v.id("rooms"),
    userId: v.id("users"), // the account behind this seat
    name: v.string(),
    joinedAt: v.number(),
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
});
