import { httpAction, env } from "./_generated/server";
import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { canonicalizeHandle, xUrl } from "../src/lib/handle";
import { UNIT_CENTS, isValidAmount } from "../src/lib/pricing";
import { verifyCreemSignature } from "../src/lib/webhook-signature";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd ? fwd.split(",")[0].trim() : "") || req.headers.get("cf-connecting-ip")?.trim() || "unknown";
}

/**
 * POST /api/checkout  { handle, amountCents }
 * Rate-limits per IP, creates the entry if new (boosts otherwise), then
 * sequences mutation → Creem action → patch. Returns the hosted checkout URL.
 */
const createCheckout = httpAction(async (ctx, req) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const { handle: rawHandle, amountCents } = (body ?? {}) as {
    handle?: unknown;
    amountCents?: unknown;
  };
  const handle = typeof rawHandle === "string" ? canonicalizeHandle(rawHandle) : null;
  if (!handle) return json({ error: "invalid_handle" }, 400);
  if (
    typeof amountCents !== "number" ||
    !Number.isInteger(amountCents) ||
    !isValidAmount(amountCents)
  ) {
    return json({ error: "invalid_amount" }, 400);
  }

  let paymentId;
  try {
    paymentId = await ctx.runMutation(internal.payments.createPendingPayment, {
      handle,
      amountCents,
      ip: clientIp(req),
    });
  } catch (err) {
    if (err instanceof ConvexError) {
      const msg = typeof err.data === "string" ? err.data : "";
      if (msg.startsWith("RATE_LIMITED")) {
        return json({ error: "rate_limited", retryAfterSeconds: Number(msg.split(":")[1]) || 3600 }, 429);
      }
      if (msg === "ENTRY_REMOVED") return json({ error: "entry_removed" }, 400);
    }
    throw err;
  }

  const checkout = await ctx.runAction(internal.checkouts.createCreemCheckout, {
    paymentId,
    units: amountCents / UNIT_CENTS,
  });
  await ctx.runMutation(internal.payments.attachCheckout, {
    paymentId,
    checkoutId: checkout.checkoutId,
  });
  return json({ paymentId, checkoutUrl: checkout.checkoutUrl }, 200);
});

type CreemWebhookEvent = {
  id?: string;
  eventType?: string;
  object?: {
    id?: string;
    request_id?: string;
    metadata?: Record<string, unknown>;
    order?: { id?: string; amount?: number; status?: string };
    customer?: { email?: string };
    checkout?: { request_id?: string };
  };
};

/**
 * POST /api/webhooks/creem — verifies the HMAC signature, then:
 *  - checkout.completed → mark paid + credit entry (idempotent)
 *  - refund.created / dispute.created → subtract from entry total
 */
const creemWebhook = httpAction(async (ctx, req) => {
  const secret = env.CREEM_WEBHOOK_SECRET;
  if (!secret) return new Response("webhook not configured", { status: 500 });

  const raw = await req.text();
  const signature = req.headers.get("creem-signature");
  if (!signature || !(await verifyCreemSignature(raw, secret, signature))) {
    return new Response("invalid signature", { status: 400 });
  }

  let event: CreemWebhookEvent;
  try {
    event = JSON.parse(raw) as CreemWebhookEvent;
  } catch {
    return new Response("invalid payload", { status: 400 });
  }

  switch (event.eventType) {
    case "checkout.completed": {
      if (event.object?.order?.status !== "paid") break; // ack non-paid states
      // Without an event id we cannot process idempotently — ack and skip.
      if (!event.id) break;
      const paymentId =
        event.object.request_id ??
        (typeof event.object.metadata?.paymentId === "string"
          ? (event.object.metadata.paymentId as string)
          : undefined);
      if (!paymentId) break;
      await ctx.runMutation(internal.payments.markPaid, {
        eventId: event.id,
        paymentId,
        orderId: event.object.order.id,
        customerEmail: event.object.customer?.email,
      });
      break;
    }
    case "refund.created":
    case "dispute.created": {
      if (!event.id) break;
      await ctx.runMutation(internal.payments.refundPayment, {
        eventId: event.id,
        paymentId: event.object?.checkout?.request_id,
        orderId: event.object?.order?.id,
      });
      break;
    }
    default:
      break; // unrelated lifecycle events are acknowledged and ignored
  }
  // Always 200 for validly-signed deliveries so Creem stops retrying.
  return new Response(null, { status: 200 });
});

/** GET /api/c/{entryId} — count the click, then bounce to x.com. */
const trackClick = httpAction(async (ctx, req) => {
  const entryId = new URL(req.url).pathname.slice("/api/c/".length);
  if (!/^[a-z0-9]+$/i.test(entryId)) return new Response("bad id", { status: 400 });
  try {
    const result = await ctx.runMutation(internal.entries.registerClick, {
      entryId: entryId as import("./_generated/dataModel").Id<"entries">,
    });
    if (!result) return new Response("not found", { status: 404 });
    return Response.redirect(xUrl(result.handle), 302);
  } catch {
    return new Response("not found", { status: 404 });
  }
});

const http = httpRouter();

http.route({
  path: "/api/checkout",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders })),
});
http.route({ path: "/api/checkout", method: "POST", handler: createCheckout });

http.route({ path: "/api/webhooks/creem", method: "POST", handler: creemWebhook });

http.route({ pathPrefix: "/api/c/", method: "GET", handler: trackClick });

export default http;
