import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // One row per successfully scanned receipt.
  receipts: defineTable({
    userKey: v.string(), // hashed anonymous browser id (never exposed to clients)
    storeName: v.union(v.string(), v.null()),
    totalAmount: v.union(v.number(), v.null()),
    currency: v.union(v.string(), v.null()),
    purchaseDate: v.union(v.string(), v.null()), // ISO "YYYY-MM-DD"
  }).index("by_user", ["userKey"]),

  // One row per scan attempt; used for rate limiting and concurrency control.
  scanEvents: defineTable({
    userKey: v.string(),
    ipKey: v.string(), // hashed IP address
    status: v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("failed"),
    ),
    createdAt: v.number(),
  })
    .index("by_user_time", ["userKey", "createdAt"])
    .index("by_ip_time", ["ipKey", "createdAt"])
    .index("by_time", ["createdAt"]),

  // Singleton counter so the global cap doesn't require scanning the table.
  stats: defineTable({
    name: v.literal("global"),
    totalReceipts: v.number(),
  }).index("by_name", ["name"]),
});
