/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const SECRET = "whsec_test_abc123";

afterEach(() => {
  vi.useRealTimers();
  delete process.env.CREEM_WEBHOOK_SECRET;
});

/** Sign a payload the same way Creem does: HMAC-SHA256 hex of the raw body. */
async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function postWebhook(
  t: ReturnType<typeof convexTest>,
  body: string,
  signature: string | null,
): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature !== null) headers["creem-signature"] = signature;
  return t.fetch("/api/webhooks/creem", { method: "POST", headers, body });
}

function checkoutCompletedEvent(
  paymentId: string,
  eventId: string,
  amount = 500,
  currency: string | null = "USD",
): string {
  return JSON.stringify({
    id: eventId,
    eventType: "checkout.completed",
    created_at: Date.now(),
    object: {
      id: `ch_${eventId}`,
      object: "checkout",
      request_id: paymentId,
      status: "completed",
      metadata: { paymentId },
      order: {
        id: `ord_${eventId}`,
        amount,
        currency: currency ?? undefined,
        status: "paid",
      },
      customer: { id: "cust_1", email: "buyer@example.com" },
    },
  });
}

describe("POST /api/webhooks/creem", () => {
  it("credits a validly-signed checkout.completed and stays idempotent on replay", async () => {
    process.env.CREEM_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    vi.useFakeTimers({ now: 1_700_000_000_000 });

    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "webhooky",
      amountCents: 500,
      ip: "1.2.3.4",
    });

    const event = checkoutCompletedEvent(paymentId, "evt_once");
    const res1 = await postWebhook(t, event, await sign(event));
    expect(res1.status).toBe(200);

    // Same event delivered again (Creem retries): still 200, no double credit.
    const res2 = await postWebhook(t, event, await sign(event));
    expect(res2.status).toBe(200);

    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board).toHaveLength(1);
    expect(board[0].totalCents).toBe(500);
    expect(board[0].bidCount).toBe(1);
    const stats = await t.query(api.entries.siteStats, {});
    expect(stats.paidCents).toBe(500);
  });

  it("rejects tampered payloads with 400 and credits nothing", async () => {
    process.env.CREEM_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    vi.useFakeTimers({ now: 1_700_000_000_000 });

    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "sneaky",
      amountCents: 500,
      ip: "1.2.3.5",
    });
    const signedEvent = checkoutCompletedEvent(paymentId, "evt_t");
    const signature = await sign(signedEvent);
    // Tamper AFTER signing.
    const tampered = signedEvent.replace('"amount":500', '"amount":999999');
    expect(tampered).not.toBe(signedEvent);

    const res = await postWebhook(t, tampered, signature);
    expect(res.status).toBe(400);

    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board).toEqual([]);
  });

  it("refunds a validly-signed event whose amount mismatches the priced payment", async () => {
    process.env.CREEM_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    vi.useFakeTimers({ now: 1_700_000_000_000 });

    // Priced at $10; Creem reports only $5 paid (product price drift).
    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "underpaid",
      amountCents: 1000,
      ip: "1.2.3.6",
    });
    const underpaid = checkoutCompletedEvent(paymentId, "evt_under", 500);
    const res = await postWebhook(t, underpaid, await sign(underpaid));
    expect(res.status).toBe(200); // acked so Creem stops retrying

    const status = await t.query(api.payments.publicPaymentStatus, { paymentId });
    expect(status?.status).toBe("refund_pending");
    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board).toEqual([]);
    const stats = await t.query(api.entries.siteStats, {});
    expect(stats.paidCents).toBe(0);
  });

  it.each([
    ["incorrect", "EUR"],
    ["absent", null],
  ])("refunds a checkout with %s order currency", async (_label, currency) => {
    process.env.CREEM_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: `currency${currency ?? "missing"}`,
      amountCents: 500,
      ip: `1.2.4.${currency ? "1" : "2"}`,
    });
    const event = checkoutCompletedEvent(paymentId, `evt_currency_${currency ?? "none"}`, 500, currency);
    const res = await postWebhook(t, event, await sign(event));
    expect(res.status).toBe(200);

    const status = await t.query(api.payments.publicPaymentStatus, { paymentId });
    expect(status?.status).toBe("refund_pending");
    expect(await t.query(api.entries.board, { limit: 10 })).toEqual([]);
  });

  it("rejects missing or wrong signatures", async () => {
    process.env.CREEM_WEBHOOK_SECRET = SECRET;
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);

    const event = checkoutCompletedEvent("unusedpaymentid", "evt_sig");
    const noSig = await postWebhook(t, event, null);
    expect(noSig.status).toBe(400);
    const badSig = await postWebhook(t, event, "deadbeef");
    expect(badSig.status).toBe(400);
  });
});
