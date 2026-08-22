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
      v.literal("refund_pending"),
      v.literal("refunded"),
    ),
    checkoutId: v.optional(v.string()),
    orderId: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    eventId: v.optional(v.string()), // completion webhook id — idempotency key
    customerEmail: v.optional(v.string()),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
    refundStatus: v.optional(
      v.union(
        v.literal("scheduled"),
        v.literal("attempting"),
        v.literal("pending"),
        v.literal("retrying"),
        v.literal("reconciliation_required"),
        v.literal("succeeded"),
      ),
    ),
    refundAttempts: v.optional(v.number()),
    refundLastError: v.optional(v.string()),
    refundUpdatedAt: v.optional(v.number()),
  })
    .index("by_entry", ["entryId"])
    .index("by_event_id", ["eventId"])
    .index("by_order_id", ["orderId"])
    .index("by_transaction_id", ["transactionId"])
    .index("by_entry_status_paid", ["entryId", "status", "paidAt"])
    .index("by_status_paid", ["status", "paidAt"]),

  // Provider reversals are recorded independently so an out-of-order refund
  // or dispute cannot be lost before its completion webhook identifies payment.
  paymentReversals: defineTable({
    eventId: v.string(),
    paymentId: v.optional(v.string()),
    orderId: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_payment_id", ["paymentId"])
    .index("by_order_id", ["orderId"])
    .index("by_transaction_id", ["transactionId"]),

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
