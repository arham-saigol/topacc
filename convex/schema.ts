import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  entries: defineTable({
    // Canonical: lowercased, no @, ^[a-z0-9_]{1,15}$
    handle: v.string(),
    totalCents: v.number(),
    bidCount: v.number(),
    clickCount: v.number(),
    status: v.union(v.literal("active"), v.literal("removed")),
    createdAt: v.number(),
    lastBidAt: v.number(),
  })
    .index("by_handle", ["handle"])
    .index("by_status_and_total", ["status", "totalCents"]),

  payments: defineTable({
    entryId: v.id("entries"),
    amountCents: v.number(), // always a multiple of 500, >= 500
    units: v.number(), // amountCents / 500
    status: v.union(
      v.literal("pending"),
      v.literal("paid"),
      v.literal("expired"),
      v.literal("refunded"),
    ),
    checkoutId: v.optional(v.string()),
    orderId: v.optional(v.string()),
    eventId: v.optional(v.string()), // webhook id — idempotency key
    customerEmail: v.optional(v.string()),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index("by_entry", ["entryId"])
    .index("by_event_id", ["eventId"])
    .index("by_order_id", ["orderId"])
    .index("by_status_created", ["status", "createdAt"]),

  profileCache: defineTable({
    handle: v.string(), // canonical
    avatarUrl: v.optional(v.string()),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()), // rendered truncated to one line
    verified: v.optional(v.boolean()),
    fetchedAt: v.number(), // refetch if older than ~7 days
  }).index("by_handle", ["handle"]),

  // Singleton row (id fixed by convention in code): net revenue in cents.
  siteStats: defineTable({
    paidCents: v.number(),
  }),
});
