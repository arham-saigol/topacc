import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { rateLimiter } from "./rateLimiter";
import { MAX_REFUND_ATTEMPTS, PAYMENT_TTL_MS, PROFILE_TTL_MS } from "./shared";
import { canonicalizeHandle } from "../src/lib/handle";
import { UNIT_CENTS, isValidAmount } from "../src/lib/pricing";

const paymentStatusValidator = v.union(
  v.literal("pending"),
  v.literal("paid"),
  v.literal("expired"),
  v.literal("refund_pending"),
  v.literal("refunded"),
);

const refundResultValidator = v.union(
  v.literal("refund_pending"),
  v.literal("reconciliation_required"),
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

async function recordedReversal(
  ctx: MutationCtx,
  ids: { paymentId: string; orderId?: string; transactionId?: string },
) {
  const byPayment = await ctx.db
    .query("paymentReversals")
    .withIndex("by_payment_id", (q) => q.eq("paymentId", ids.paymentId))
    .first();
  if (byPayment) return byPayment;
  if (ids.orderId) {
    const byOrder = await ctx.db
      .query("paymentReversals")
      .withIndex("by_order_id", (q) => q.eq("orderId", ids.orderId))
      .first();
    if (byOrder) return byOrder;
  }
  if (ids.transactionId) {
    return await ctx.db
      .query("paymentReversals")
      .withIndex("by_transaction_id", (q) =>
        q.eq("transactionId", ids.transactionId),
      )
      .first();
  }
  return null;
}

async function queueRefund(
  ctx: MutationCtx,
  payment: Doc<"payments">,
  refs: {
    eventId: string;
    orderId?: string;
    transactionId?: string;
  },
): Promise<"refund_pending" | "reconciliation_required"> {
  const checkoutId = payment.checkoutId || undefined;
  const orderId = refs.orderId ?? payment.orderId;
  const transactionId = refs.transactionId ?? payment.transactionId;
  const now = Date.now();

  if (!checkoutId && !orderId && !transactionId) {
    await ctx.db.patch(payment._id, {
      status: "refund_pending",
      eventId: refs.eventId,
      refundStatus: "reconciliation_required",
      refundAttempts: 0,
      refundLastError: "No checkout, order, or transaction identifier",
      refundUpdatedAt: now,
    });
    return "reconciliation_required";
  }

  await ctx.db.patch(payment._id, {
    status: "refund_pending",
    eventId: refs.eventId,
    orderId,
    transactionId,
    refundStatus: "scheduled",
    refundAttempts: 0,
    refundUpdatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.checkouts.refundCreemPayment, {
    paymentId: payment._id,
    attempt: 1,
  });
  return "refund_pending";
}

/**
 * Webhook handler for checkout.completed: credit a valid payment atomically,
 * or durably start a refund when the charge cannot be fulfilled.
 */
export const markPaid = internalMutation({
  args: {
    eventId: v.string(),
    paymentId: v.string(),
    paidAmountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    orderId: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    customerEmail: v.optional(v.string()),
  },
  returns: v.union(
    v.literal("credited"),
    v.literal("already_processed"),
    v.literal("unknown_payment"),
    v.literal("refunded"),
    refundResultValidator,
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
    if (
      payment.status === "paid" ||
      payment.status === "refund_pending" ||
      payment.status === "refunded"
    ) {
      return "already_processed";
    }

    const reversal = await recordedReversal(ctx, {
      paymentId: args.paymentId,
      orderId: args.orderId,
      transactionId: args.transactionId,
    });
    if (reversal) {
      await ctx.db.patch(payment._id, {
        status: "refunded",
        eventId: args.eventId,
        orderId: args.orderId,
        transactionId: args.transactionId,
        refundStatus: "succeeded",
        refundUpdatedAt: Date.now(),
      });
      return "refunded";
    }

    const now = Date.now();
    const entry = await ctx.db.get(payment.entryId);
    const amountMismatch =
      typeof args.paidAmountCents === "number" &&
      (!Number.isInteger(args.paidAmountCents) ||
        args.paidAmountCents !== payment.amountCents);
    const currencyMismatch = args.currency !== "USD";

    if (
      payment.status === "expired" ||
      !entry ||
      entry.status !== "active" ||
      amountMismatch ||
      currencyMismatch
    ) {
      return await queueRefund(ctx, payment, {
        eventId: args.eventId,
        orderId: args.orderId,
        transactionId: args.transactionId,
      });
    }

    await ctx.db.patch(payment._id, {
      status: "paid",
      paidAt: now,
      eventId: args.eventId,
      orderId: args.orderId,
      transactionId: args.transactionId,
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

/**
 * Start a durable refund attempt. The next attempt is scheduled before any
 * provider I/O so an action crash cannot strand a charged payment.
 */
export const beginRefundAttempt = internalMutation({
  args: { paymentId: v.id("payments"), attempt: v.number() },
  returns: v.union(
    v.object({
      checkoutId: v.optional(v.string()),
      orderId: v.optional(v.string()),
      transactionId: v.optional(v.string()),
      phase: v.union(v.literal("request"), v.literal("reconcile")),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.status !== "refund_pending") return null;

    if (args.attempt > MAX_REFUND_ATTEMPTS) {
      await ctx.db.patch(payment._id, {
        refundStatus: "reconciliation_required",
        refundUpdatedAt: Date.now(),
      });
      return null;
    }

    const phase: "request" | "reconcile" =
      payment.refundStatus === "pending" && args.attempt % 6 !== 0
        ? "reconcile"
        : "request";
    const retryDelayMs = Math.min(
      60 * 60_000,
      60_000 * 2 ** Math.min(Math.max(args.attempt - 1, 0), 6),
    );

    await ctx.db.patch(payment._id, {
      refundStatus: "attempting",
      refundAttempts: args.attempt,
      refundUpdatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      retryDelayMs,
      internal.checkouts.refundCreemPayment,
      { paymentId: payment._id, attempt: args.attempt + 1 },
    );

    return {
      checkoutId: payment.checkoutId || undefined,
      orderId: payment.orderId,
      transactionId: payment.transactionId,
      phase,
    };
  },
});

/** Persist a provider refund outcome; only succeeded is terminal locally. */
export const recordRefundOutcome = internalMutation({
  args: {
    paymentId: v.id("payments"),
    outcome: v.union(
      v.literal("pending"),
      v.literal("retrying"),
      v.literal("succeeded"),
    ),
    transactionId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const payment = await ctx.db.get(args.paymentId);
    if (!payment || payment.status !== "refund_pending") return null;

    await ctx.db.patch(payment._id, {
      status: args.outcome === "succeeded" ? "refunded" : "refund_pending",
      transactionId: args.transactionId ?? payment.transactionId,
      refundStatus: args.outcome,
      refundLastError: args.error,
      refundUpdatedAt: Date.now(),
    });
    return null;
  },
});

/** Refund/dispute path: record first, then subtract a previously credited bid. */
export const refundPayment = internalMutation({
  args: {
    eventId: v.string(),
    paymentId: v.optional(v.string()),
    orderId: v.optional(v.string()),
    transactionId: v.optional(v.string()),
  },
  returns: v.union(v.literal("refunded"), v.literal("recorded")),
  handler: async (ctx, args) => {
    const seenEvent = await ctx.db
      .query("paymentReversals")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .first();
    if (seenEvent) return "refunded";

    await ctx.db.insert("paymentReversals", {
      eventId: args.eventId,
      paymentId: args.paymentId,
      orderId: args.orderId,
      transactionId: args.transactionId,
      createdAt: Date.now(),
    });

    let payment: Doc<"payments"> | null = null;
    const normalizedId = args.paymentId
      ? ctx.db.normalizeId("payments", args.paymentId)
      : null;
    if (normalizedId) payment = await ctx.db.get(normalizedId);
    if (!payment && args.orderId) {
      payment = await ctx.db
        .query("payments")
        .withIndex("by_order_id", (q) => q.eq("orderId", args.orderId))
        .first();
    }
    if (!payment && args.transactionId) {
      payment = await ctx.db
        .query("payments")
        .withIndex("by_transaction_id", (q) =>
          q.eq("transactionId", args.transactionId),
        )
        .first();
    }
    if (!payment) return "recorded";
    if (payment.status === "refunded") return "refunded";

    // Mark refunded first so the recompute below only sees remaining bids.
    await ctx.db.patch(payment._id, {
      status: "refunded",
      orderId: payment.orderId ?? args.orderId,
      transactionId: payment.transactionId ?? args.transactionId,
      refundStatus: "succeeded",
      refundUpdatedAt: Date.now(),
    });

    if (payment.status === "paid") {
      const entry = await ctx.db.get(payment.entryId);
      if (entry) {
        // Ties go to whoever reached a total first (compareEntries), so
        // lastBidAt must be restored to when the newest remaining paid bid
        // completed instead of pointing at the refunded bid. The composite
        // index keeps this a bounded single-row read as bids accumulate.
        const latestPaid = await ctx.db
          .query("payments")
          .withIndex("by_entry_status_paid", (q) =>
            q.eq("entryId", entry._id).eq("status", "paid"),
          )
          .order("desc")
          .first();
        await ctx.db.patch(entry._id, {
          totalCents: Math.max(0, entry.totalCents - payment.amountCents),
          lastBidAt: latestPaid
            ? (latestPaid.paidAt ?? latestPaid.createdAt)
            : entry.lastBidAt,
        });
      }
      await bumpRevenue(ctx, -payment.amountCents);
    }

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
