"use node";

import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";

/**
 * Calls Creem's create-checkout API. One product ("$5 Bid Credit"); larger
 * bids are `units = amountCents / 500` on that product. Test-mode keys
 * (`creem_test_…`) automatically hit the sandbox API.
 */
export const createCreemCheckout = internalAction({
  args: { paymentId: v.id("payments"), units: v.number() },
  returns: v.object({ checkoutUrl: v.string(), checkoutId: v.string() }),
  handler: async (_ctx, args) => {
    const apiKey = env.CREEM_API_KEY;
    const productId = env.CREEM_PRODUCT_ID;
    if (!apiKey || !productId) {
      throw new Error("Creem is not configured: set CREEM_API_KEY and CREEM_PRODUCT_ID");
    }
    const siteUrl = env.SITE_URL ?? "https://topacc.lol";
    const base = apiKey.startsWith("creem_test_")
      ? "https://test-api.creem.io"
      : "https://api.creem.io";

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
