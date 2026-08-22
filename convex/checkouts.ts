"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, env } from "./_generated/server";

function creemConfig() {
  const apiKey = env.CREEM_API_KEY;
  if (!apiKey) throw new Error("Creem is not configured: set CREEM_API_KEY");
  // Test-mode keys (`creem_test_…`) automatically hit the sandbox API.
  const base = apiKey.startsWith("creem_test_")
    ? "https://test-api.creem.io"
    : "https://api.creem.io";
  return { apiKey, base };
}

/**
 * Calls Creem's create-checkout API. One product ("$5 Bid Credit"); larger
 * bids are `units = amountCents / 500` on that product.
 */
export const createCreemCheckout = internalAction({
  args: { paymentId: v.id("payments"), units: v.number() },
  returns: v.object({ checkoutUrl: v.string(), checkoutId: v.string() }),
  handler: async (_ctx, args) => {
    const { apiKey, base } = creemConfig();
    const productId = env.CREEM_PRODUCT_ID;
    if (!productId) {
      throw new Error("Creem is not configured: set CREEM_PRODUCT_ID");
    }
    const siteUrl = env.SITE_URL ?? "https://topacc.lol";

    const res = await fetch(`${base}/v1/checkouts`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        product_id: productId,
        units: args.units,
        request_id: args.paymentId,
        success_url: `${siteUrl}/success?ref=${args.paymentId}`,
        metadata: { paymentId: args.paymentId },
      }),
    });
    if (!res.ok) {
      throw new Error(`Creem checkout failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      id?: string;
      checkout_url?: string;
      checkoutUrl?: string;
    };
    const checkoutUrl = data.checkout_url ?? data.checkoutUrl;
    if (!checkoutUrl) throw new Error("Creem response missing checkout_url");
    return { checkoutUrl, checkoutId: data.id ?? "" };
  },
});

type Transaction = { id?: string; status?: string; order?: string | null };

async function providerJson(
  url: string,
  apiKey: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "x-api-key": apiKey,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Creem request failed (${res.status})`);
  }
  return await res.json();
}

async function resolveTransaction(
  base: string,
  apiKey: string,
  refs: { checkoutId?: string; orderId?: string; transactionId?: string },
): Promise<string> {
  if (refs.transactionId) return refs.transactionId;

  if (refs.checkoutId) {
    const checkout = (await providerJson(
      `${base}/v1/checkouts?checkout_id=${encodeURIComponent(refs.checkoutId)}`,
      apiKey,
    )) as {
      transaction?: string | null;
      order?: string | { transaction?: string | null } | null;
    };
    const transaction =
      checkout.transaction ??
      (typeof checkout.order === "object" ? checkout.order?.transaction : undefined);
    if (transaction) return transaction;
  }

  if (refs.orderId) {
    const search = (await providerJson(
      `${base}/v1/transactions/search?order_id=${encodeURIComponent(refs.orderId)}&page_size=1`,
      apiKey,
    )) as { items?: Transaction[] };
    const transaction = search.items?.[0]?.id;
    if (transaction) return transaction;
  }

  throw new Error("Creem payment identifiers did not resolve to a transaction");
}

/**
 * Reverses an unfulfillable charge. beginRefundAttempt persists the attempt
 * and schedules its retry before provider I/O; only a confirmed provider
 * success transitions the payment to refunded.
 */
export const refundCreemPayment = internalAction({
  args: { paymentId: v.id("payments"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attempt = await ctx.runMutation(internal.payments.beginRefundAttempt, args);
    if (!attempt) return null;

    let transactionId = attempt.transactionId;
    try {
      const { apiKey, base } = creemConfig();
      transactionId = await resolveTransaction(base, apiKey, attempt);

      const transaction = (await providerJson(
        `${base}/v1/transactions?transaction_id=${encodeURIComponent(transactionId)}`,
        apiKey,
      )) as Transaction;
      if (transaction.status === "refunded" || transaction.status === "chargedBack") {
        await ctx.runMutation(internal.payments.recordRefundOutcome, {
          paymentId: args.paymentId,
          outcome: "succeeded",
          transactionId,
        });
        return null;
      }

      if (attempt.phase === "reconcile") {
        await ctx.runMutation(internal.payments.recordRefundOutcome, {
          paymentId: args.paymentId,
          outcome: "pending",
          transactionId,
          error: `Refund still processing (transaction ${transaction.status ?? "unknown"})`,
        });
        return null;
      }

      const refund = (await providerJson(`${base}/v1/refunds`, apiKey, {
        method: "POST",
        body: JSON.stringify({ transaction_id: transactionId }),
      })) as { status?: string };

      if (refund.status === "succeeded") {
        await ctx.runMutation(internal.payments.recordRefundOutcome, {
          paymentId: args.paymentId,
          outcome: "succeeded",
          transactionId,
        });
      } else if (refund.status === "pending" || refund.status === "requiresAction") {
        await ctx.runMutation(internal.payments.recordRefundOutcome, {
          paymentId: args.paymentId,
          outcome: "pending",
          transactionId,
          error: `Creem refund ${refund.status}`,
        });
      } else {
        await ctx.runMutation(internal.payments.recordRefundOutcome, {
          paymentId: args.paymentId,
          outcome: "retrying",
          transactionId,
          error: `Creem refund ${refund.status ?? "returned no status"}`,
        });
      }
    } catch (error) {
      await ctx.runMutation(internal.payments.recordRefundOutcome, {
        paymentId: args.paymentId,
        outcome: "retrying",
        transactionId,
        error: error instanceof Error ? error.message.slice(0, 300) : "Unknown refund error",
      });
    }
    return null;
  },
});
