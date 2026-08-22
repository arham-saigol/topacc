import { ConvexError, v } from "convex/values";
import { internalMutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { rateLimiter } from "./rateLimiter";
import { PAYMENT_TTL_MS, PROFILE_TTL_MS } from "./shared";
import { canonicalizeHandle } from "../src/lib/handle";
import { UNIT_CENTS, isValidAmount } from "../src/lib/pricing";

const paymentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("expired"),
  v.literal("refunded"),
);

/**
 * All payment-state transitions live here so every money path is a single
 * serializable transaction: webhook handlers cannot corrupt totals, and
 * duplicate deliveries are absorbed by idempotency guards.
 */

/** Create the pending payment row for a checkout attempt (rate-limited per IP). */
export const createPendingPayment = internalMutation({
  args: {
    handle: v.string(), // raw user input; canonicalized here
    amountCents: v.number(),
    ip: v.string(),
  },
  returns: v.id("payments"),
  handler: async (ctx, args) => {
    // Canonicalize at the write boundary so the one-entry-per-handle
    // invariant holds for every caller, present and future.
    const handle = canonicalizeHandle(args.handle);
    if (!handle) throw new ConvexError("INVALID_HANDLE");
    // Shared pricing rule so units and stored fields keep the $5-multiple
    // invariant even for non-HTTP callers.
    if (!isValidAmount(args.amountCents)) throw new ConvexError("INVALID_AMOUNT");

    const limit = await rateLimiter.limit(ctx, "createCheckout", {
      key: args.ip,
      throws: false,
    });
    if (!limit.ok) {
      throw new ConvexError(
        `RATE_LIMITED:${Math.ceil((limit.retryAfter ?? 60_000) / 1000)}`,
      );
    }

    const now = Date.now();
    const entry = await ctx.db
      .query("entries")
      .withIndex("by_handle", (q) => q.eq("handle", handle))
      .first();
    let entryId: import("./_generated/dataModel").Id<"entries">;
    if (!entry) {
      entryId = await ctx.db.insert("entries", {
        handle,
        totalCents: 0,
        bidCount: 0,
        clickCount: 0,
        status: "active",
        createdAt: now,
        lastBidAt: now,
      });
    } else if (entry.status === "removed") {
      throw new ConvexError("ENTRY_REMOVED");
    } else {
      entryId = entry._id;
    }

    const paymentId = await ctx.db.insert("payments", {
      entryId,
      amountCents: args.amountCents,
      units: args.amountCents / UNIT_CENTS, // derived, never trusted from callers
      status: "pending",
      createdAt: now,
    });

    await ctx.scheduler.runAt(now + PAYMENT_TTL_MS, internal.payments.expirePayment, {
      paymentId,
    });
    return paymentId;
  },
});

/** Store the Creem checkout id on the pending row. */
export const attachCheckout = internalMutation({
  args: { paymentId: v.id("payments"), checkoutId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.status !== "pending") return null;
    await ctx.db.patch(args.paymentId, { checkoutId: args.checkoutId });
    return null;
  },
});

/**
 * Webhook handler for checkout.completed: mark paid and credit the entry,
 * atomically. Idempotent by webhook event id AND by payment state.
 *
 * Fulfillment requires an active entry AND a provider-reported amount that
 * matches what we priced. Anything else (entry removed mid-checkout, price
 * drift on the provider) reverses the charge via refundCreemPayment instead
 * of taking money without granting the leaderboard credit.
 */
export const markPaid = internalMutation({
  args: {
    eventId: v.string(),
    paymentId: v.string(),
    paidAmountCents: v.optional(v.number()),
    orderId: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
  },
  returns: v.union(
    v.literal("credited"),
    v.literal("already_processed"),
    v.literal("unknown_payment"),
    v.literal("refunded"),
  ),
  handler: async (ctx, args) => {
    const seenEvent = await ctx.db
      .query("payments")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (seenEvent) return "already_processed";

    const normalizedId = ctx.db.normalizeId("payments", args.paymentId);
    if (!normalizedId) return "unknown_payment";
    const payment = await ctx.db.get(normalizedId);
    if (!payment) return "unknown_payment";
    if (payment.status !== "pending") return "already_processed"; // expired/refunded/paid

    const now = Date.now();
    const entry = await ctx.db.get(payment.entryId);
    // When the webhook reports what was actually charged, it must match
    // what we priced — a mismatch means provider price drift, not credit.
    const amountMismatch =
      typeof args.paidAmountCents === "number" &&
      (!Number.isInteger(args.paidAmountCents) ||
        args.paidAmountCents !== payment.amountCents);

    if (!entry || entry.status !== "active" || amountMismatch) {
      // Unfulfillable: reverse the charge instead of reporting success.
      await ctx.db.patch(payment._id, { status: "refunded", eventId: args.eventId });
      if (payment.checkoutId) {
        await ctx.scheduler.runAfter(0, internal.checkouts.refundCreemPayment, {
          checkoutId: payment.checkoutId,
        });
      }
      return "refunded";
    }

    await ctx.db.patch(payment._id, {
      status: "paid",
      paidAt: now,
      eventId: args.eventId,
      orderId: args.orderId,
      customerEmail: args.customerEmail,
    });

    await ctx.db.patch(entry._id, {
      totalCents: entry.totalCents + payment.amountCents,
      bidCount: entry.bidCount + 1,
      lastBidAt: now,
    });
    await bumpRevenue(ctx, payment.amountCents);

    // Enrich profile data out-of-band so the webhook stays fast.
    const cache = await ctx.db
      .query("profileCache")
      .withIndex("by_handle", (q) => q.eq("handle", entry.handle))
      .first();
    if (!cache || now - cache.fetchedAt > PROFILE_TTL_MS) {
      await ctx.scheduler.runAfter(0, internal.profiles_fetch.enrichEntry, {
        entryId: entry._id,
      });
    }
    return "credited";
  },
});

/** Refund/dispute path: subtract from the entry total, floored at 0. */
export const refundPayment = internalMutation({
  args: {
    eventId: v.string(),
    paymentId: v.optional(v.string()),
    orderId: v.optional(v.string()),
  },
  returns: v.union(v.literal("refunded"), v.literal("ignored")),
  handler: async (ctx, args) => {
    const seenEvent = await ctx.db
      .query("payments")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (seenEvent) return "refunded";

    let payment = null;
    const normalizedId = args.paymentId
      ? ctx.db.normalizeId("payments", args.paymentId)
      : null;
    if (normalizedId) {
      payment = await ctx.db.get(normalizedId);
    }
    if (!payment && args.orderId) {
      payment = await ctx.db
        .query("payments")
        .withIndex("by_order_id", (q) => q.eq("orderId", args.orderId))
        .first();
    }
    if (!payment || payment.status !== "paid") return "ignored";

    // Persist the event id so redelivered refund events are recognized.
    await ctx.db.patch(payment._id, { status: "refunded", eventId: args.eventId });

    const entry = await ctx.db.get(payment.entryId);
    if (entry) {
      await ctx.db.patch(entry._id, {
        totalCents: Math.max(0, entry.totalCents - payment.amountCents),
      });
    }
    await bumpRevenue(ctx, -payment.amountCents);
    return "refunded";
  },
});

/** Scheduled at creation time; flips still-pending rows to expired. */
export const expirePayment = internalMutation({
  args: { paymentId: v.id("payments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.status !== "pending") return null;
    await ctx.db.patch(args.paymentId, { status: "expired" });
    return null;
  },
});

/**
 * Success-page lookup by the opaque ref in /success?ref=. Exposes only what
 * the payer already knows (amount + resulting handle), never email.
 */
export const publicPaymentStatus = query({
  args: { paymentId: v.id("payments") },
  returns: v.union(
    v.object({
      status: paymentStatusValidator,
      amountCents: v.number(),
      handle: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment) return null;
    const entry = await ctx.db.get(payment.entryId);
    return {
      status: payment.status,
      amountCents: payment.amountCents,
      handle: entry?.status === "active" ? entry.handle : undefined,
    };
  },
});

/** Net revenue counter (singleton-ish row; concurrent cold-start races add rows). */
export async function bumpRevenue(ctx: MutationCtx, deltaCents: number) {
  const row = await ctx.db.query("siteStats").first();
  if (!row) {
    await ctx.db.insert("siteStats", { paidCents: Math.max(0, deltaCents) });
  } else {
    await ctx.db.patch(row._id, { paidCents: Math.max(0, row.paidCents + deltaCents) });
  }
}
