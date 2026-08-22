"use node";

import { v } from "convex/values";
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

/**
 * Reverses a charge we cannot fulfill (removed entry / mismatched amount).
 * Resolves the paid transaction from the stored checkout, then requests a
 * full refund. Throws so the scheduler retries until Creem confirms.
 */
export const refundCreemPayment = internalAction({
  args: { checkoutId: v.string() },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const { apiKey, base } = creemConfig();

    const lookup = await fetch(
      `${base}/v1/checkouts?checkout_id=${encodeURIComponent(args.checkoutId)}`,
      { headers: { "x-api-key": apiKey } },
    );
    if (!lookup.ok) {
      throw new Error(`Creem checkout lookup failed (${lookup.status})`);
    }
    const { transaction } = (await lookup.json()) as { transaction?: string | null };
    if (!transaction) {
      throw new Error(`No transaction on checkout ${args.checkoutId} to refund`);
    }

    const refund = await fetch(`${base}/v1/refunds`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ transaction_id: transaction }),
    });
    if (!refund.ok) {
      throw new Error(
        `Creem refund failed (${refund.status}): ${(await refund.text()).slice(0, 300)}`,
      );
    }
    return null;
  },
});
