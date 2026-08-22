/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { BOARD_SCAN_CAP, MAX_REFUND_ATTEMPTS } from "./shared";
import { UNIT_CENTS } from "../src/lib/pricing";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}

const BASE_TIME = 1_700_000_000_000;

afterEach(() => {
  vi.useRealTimers();
});

type T = ReturnType<typeof convexTest>;

/** Drive a full "paid" flow through the public-ish seams: pending → paid. */
async function pay(
  t: T,
  opts: { handle: string; amountCents: number; ip: string; eventId: string },
) {
  const paymentId = await t.mutation(internal.payments.createPendingPayment, {
    handle: opts.handle,
    amountCents: opts.amountCents,
    ip: opts.ip,
  });
  return t.mutation(internal.payments.markPaid, {
    eventId: opts.eventId,
    paymentId,
    currency: "USD",
  });
}

describe("board ranking", () => {
  it("orders by total desc and breaks ties by earlier lastBidAt", async () => {
    const t = setup();
    vi.useFakeTimers({ now: BASE_TIME });

    await pay(t, { handle: "aaa", amountCents: 1000, ip: "1.1.1.1", eventId: "e1" });
    await vi.advanceTimersByTimeAsync(60_000);
    await pay(t, { handle: "bbb", amountCents: 2000, ip: "1.1.1.2", eventId: "e2" });
    await vi.advanceTimersByTimeAsync(60_000);
    // ccc reaches the same total as aaa but LATER — aaa keeps the rank.
    await pay(t, { handle: "ccc", amountCents: 1000, ip: "1.1.1.3", eventId: "e3" });

    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board.map((e) => e.handle)).toEqual(["bbb", "aaa", "ccc"]);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it("boosting an existing entry adds to its total instead of duplicating", async () => {
    const t = setup();
    vi.useFakeTimers({ now: BASE_TIME });

    await pay(t, { handle: "aaa", amountCents: 500, ip: "2.2.2.1", eventId: "f1" });
    await vi.advanceTimersByTimeAsync(60_000);
    await pay(t, { handle: "@AAA", amountCents: 1500, ip: "2.2.2.2", eventId: "f2" });

    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board).toHaveLength(1);
    expect(board[0].handle).toBe("aaa");
    expect(board[0].totalCents).toBe(2000);
    expect(board[0].bidCount).toBe(2);
  });
});

describe("payment lifecycle", () => {
  it("credits once per webhook event and absorbs replays", async () => {
    const t = setup();
    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "idem",
      amountCents: 500,
      ip: "3.3.3.1",
    });

    expect(
      await t.mutation(internal.payments.markPaid, {
        eventId: "evt_x",
        paymentId,
        currency: "USD",
      }),
    ).toBe("credited");
    // Same event redelivered.
    expect(
      await t.mutation(internal.payments.markPaid, {
        eventId: "evt_x",
        paymentId,
        currency: "USD",
      }),
    ).toBe("already_processed");
    // Different event for an already-paid payment.
    expect(
      await t.mutation(internal.payments.markPaid, {
        eventId: "evt_y",
        paymentId,
        currency: "USD",
      }),
    ).toBe("already_processed");

    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board[0].totalCents).toBe(500);
    expect(board[0].bidCount).toBe(1);
    const stats = await t.query(api.entries.siteStats, {});
    expect(stats.paidCents).toBe(500);
  });

  it("expires abandoned checkouts so they never affect the board", async () => {
    const t = setup();
    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "ghost",
      amountCents: 500,
      ip: "4.4.4.1",
    });

    await t.mutation(internal.payments.expirePayment, { paymentId });
    // A late completed charge must be refunded rather than silently ignored.
    expect(
      await t.mutation(internal.payments.markPaid, {
        eventId: "evt_g",
        paymentId,
        currency: "USD",
        orderId: "ord_expired",
      }),
    ).toBe("refund_pending");

    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board).toEqual([]);
    const stats = await t.query(api.entries.siteStats, {});
    expect(stats.paidCents).toBe(0);
  });

  it("refunds subtract from the total, floored at zero", async () => {
    const t = setup();
    vi.useFakeTimers({ now: BASE_TIME });
    await pay(t, { handle: "rrr", amountCents: 1500, ip: "5.5.5.1", eventId: "r1" });

    const boardBefore = await t.query(api.entries.board, { limit: 10 });
    const entryId = boardBefore[0].id;
    expect(boardBefore[0].totalCents).toBe(1500);

    const paymentId = await t.run(async (ctx) => {
      const p = await ctx.db
        .query("payments")
        .withIndex("by_entry", (q) => q.eq("entryId", entryId))
        .first();
      if (!p) throw new Error("no payment found for entry");
      if (p.status !== "paid") throw new Error(`DEBUG status=${p.status} eventId=${p.eventId}`);
      return p._id;
    });

    expect(
      await t.mutation(internal.payments.refundPayment, {
        eventId: "refund_1",
        paymentId,
      }),
    ).toBe("refunded");
    // Replayed refund event is a no-op (already refunded).
    expect(
      await t.mutation(internal.payments.refundPayment, {
        eventId: "refund_1",
        paymentId,
      }),
    ).toBe("refunded");

    const stats = await t.query(api.entries.siteStats, {});
    expect(stats.paidCents).toBe(0);
    // Fully refunded -> $0 total -> off the board, like any unpaid entry.
    const boardAfter = await t.query(api.entries.board, { limit: 10 });
    expect(boardAfter).toEqual([]);
  });

  it("restores the tie-break time when a later partial bid is refunded", async () => {
    const t = setup();
    vi.useFakeTimers({ now: BASE_TIME });
    // aaa bids twice: $500 at BASE_TIME and $500 at BASE_TIME + 30s
    await pay(t, { handle: "aaa", amountCents: 500, ip: "5.6.7.1", eventId: "tie_1a" });
    await vi.advanceTimersByTimeAsync(30_000);
    await pay(t, { handle: "aaa", amountCents: 500, ip: "5.6.7.1", eventId: "tie_1b" });
    await vi.advanceTimersByTimeAsync(30_000);
    // bbb reaches $1000 after aaa's second bid (at BASE_TIME + 60s), so aaa holds the rank on the tie.
    await pay(t, { handle: "bbb", amountCents: 1000, ip: "5.6.7.2", eventId: "tie_2" });
    await vi.advanceTimersByTimeAsync(60_000);
    const boostId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "aaa",
      amountCents: 500,
      ip: "5.6.7.1",
    });
    await t.mutation(internal.payments.markPaid, {
      eventId: "tie_3",
      paymentId: boostId,
      currency: "USD",
    });

    expect(
      await t.mutation(internal.payments.refundPayment, {
        eventId: "tie_refund",
        paymentId: boostId,
      }),
    ).toBe("refunded");

    // With two remaining bids (BASE_TIME and BASE_TIME + 30s), lastBidAt must be
    // restored to the NEWEST remaining timestamp (BASE_TIME + 30s), not the oldest.
    const entryA = await t.query(api.entries.entryByHandle, { handle: "aaa" });
    expect(entryA?.lastBidAt).toBe(BASE_TIME + 30_000);
    expect(entryA?.totalCents).toBe(1000);

    // Back at $1000 each, aaa still outranks bbb because it got there first (at +30s vs +60s).
    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board.map((e) => e.handle)).toEqual(["aaa", "bbb"]);
    expect(board.map((e) => e.totalCents)).toEqual([1000, 1000]);
  });

  it("records an early reversal and prevents a later completion from crediting", async () => {
    const t = setup();
    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "reordered",
      amountCents: 500,
      ip: "5.5.5.2",
    });

    expect(
      await t.mutation(internal.payments.refundPayment, {
        eventId: "refund_early",
        orderId: "ord_reordered",
        transactionId: "tran_reordered",
      }),
    ).toBe("recorded");
    expect(
      await t.mutation(internal.payments.markPaid, {
        eventId: "complete_late",
        paymentId,
        paidAmountCents: 500,
        currency: "USD",
        orderId: "ord_reordered",
        transactionId: "tran_reordered",
      }),
    ).toBe("refunded");

    expect(
      (await t.query(api.payments.publicPaymentStatus, { paymentId }))?.status,
    ).toBe("refunded");
    expect(await t.query(api.entries.board, { limit: 10 })).toEqual([]);
    expect((await t.query(api.entries.siteStats, {})).paidCents).toBe(0);
  });
});

describe("checkout rate limiting", () => {
  it("blocks the 4th checkout from one IP per hour, not other IPs", async () => {
    const t = setup();
    const attempt = (ip: string, n: number) =>
      t.mutation(internal.payments.createPendingPayment, {
        handle: `user${n}`,
        amountCents: 500,
        ip,
      });

    for (let n = 1; n <= 3; n++) await expect(attempt("9.9.9.9", n)).resolves.toBeDefined();
    await expect(attempt("9.9.9.9", 4)).rejects.toThrowError(/RATE_LIMITED/);
    await expect(attempt("8.8.8.8", 5)).resolves.toBeDefined();
  });
});

describe("click tracking", () => {
  it("increments clickCount and returns the redirect target", async () => {
    const t = setup();
    await pay(t, { handle: "clicky", amountCents: 500, ip: "6.6.6.1", eventId: "c1" });
    const board = await t.query(api.entries.board, { limit: 10 });
    const entryId = board[0].id;

    expect(await t.mutation(internal.entries.registerClick, { entryId })).toEqual({
      handle: "clicky",
    });
    expect(await t.mutation(internal.entries.registerClick, { entryId })).toEqual({
      handle: "clicky",
    });
    const row = await t.query(api.entries.entryByHandle, { handle: "clicky" });
    expect(row?.clickCount).toBe(2);
  });
});

describe("unfulfillable checkouts", () => {
  it("refunds instead of crediting when the entry was removed after checkout started", async () => {
    process.env.ADMIN_PASSWORD = "hunter2";
    try {
      const t = setup();
      const paymentId = await t.mutation(internal.payments.createPendingPayment, {
        handle: "staleacc",
        amountCents: 500,
        ip: "8.8.4.1",
      });
      const found = await t.mutation(api.admin.findEntry, {
        password: "hunter2",
        handle: "staleacc",
      });
      if (!found || typeof found === "string") throw new Error("entry not found");
      await t.mutation(api.admin.removeEntry, {
        password: "hunter2",
        entryId: found.id,
      });

      expect(
        await t.mutation(internal.payments.markPaid, {
          eventId: "evt_stale",
          paymentId,
          paidAmountCents: 500,
          currency: "USD",
          orderId: "ord_stale",
        }),
      ).toBe("refund_pending");

      const status = await t.query(api.payments.publicPaymentStatus, { paymentId });
      expect(status?.status).toBe("refund_pending");
      const board = await t.query(api.entries.board, { limit: 10 });
      expect(board).toEqual([]);
      const stats = await t.query(api.entries.siteStats, {});
      expect(stats.paidCents).toBe(0);
    } finally {
      delete process.env.ADMIN_PASSWORD;
    }
  });

  it("refunds instead of crediting on a provider-reported amount mismatch", async () => {
    const t = setup();
    vi.useFakeTimers({ now: BASE_TIME });
    // Priced at $10; the webhook reports only $5 was paid.
    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "drifted",
      amountCents: 1000,
      ip: "8.8.4.2",
    });
    expect(
      await t.mutation(internal.payments.markPaid, {
        eventId: "evt_underpaid",
        paymentId,
        paidAmountCents: 500,
        currency: "USD",
        orderId: "ord_underpaid",
      }),
    ).toBe("refund_pending");

    const board = await t.query(api.entries.board, { limit: 10 });
    expect(board).toEqual([]);
    const stats = await t.query(api.entries.siteStats, {});
    expect(stats.paidCents).toBe(0);
  });

  it("caps refund attempts and marks reconciliation_required when limit is exceeded", async () => {
    const t = setup();
    const paymentId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "retrycap",
      amountCents: 500,
      ip: "8.8.4.3",
    });
    await t.mutation(internal.payments.expirePayment, { paymentId });
    expect(
      await t.mutation(internal.payments.markPaid, {
        eventId: "evt_retrycap",
        paymentId,
        currency: "USD",
        orderId: "ord_retrycap",
      }),
    ).toBe("refund_pending");

    const attempt1 = await t.mutation(internal.payments.beginRefundAttempt, {
      paymentId,
      attempt: 1,
    });
    expect(attempt1).not.toBeNull();

    const exceeded = await t.mutation(internal.payments.beginRefundAttempt, {
      paymentId,
      attempt: MAX_REFUND_ATTEMPTS + 1,
    });
    expect(exceeded).toBeNull();

    const paymentDoc = await t.run(async (ctx) => ctx.db.get(paymentId));
    expect(paymentDoc?.status).toBe("refund_pending");
    expect(paymentDoc?.refundStatus).toBe("reconciliation_required");
  });
});

describe("activity feed", () => {
  it("orders by payment completion time, not checkout creation time", async () => {
    const t = setup();
    vi.useFakeTimers({ now: BASE_TIME });

    // bbb starts a checkout first but pays last; aaa starts later, pays first.
    const bbbId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "bbb",
      amountCents: 500,
      ip: "9.1.1.1",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const aaaId = await t.mutation(internal.payments.createPendingPayment, {
      handle: "aaa",
      amountCents: 1500,
      ip: "9.1.1.2",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await t.mutation(internal.payments.markPaid, {
      eventId: "act_a",
      paymentId: aaaId,
      currency: "USD",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await t.mutation(internal.payments.markPaid, {
      eventId: "act_b",
      paymentId: bbbId,
      currency: "USD",
    });

    const feed = await t.query(api.entries.activity, { limit: 10 });
    expect(feed.map((f) => f.handle)).toEqual(["bbb", "aaa"]);
  });

  it("returns nothing for a zero or negative limit", async () => {
    const t = setup();
    await pay(t, { handle: "feedme", amountCents: 500, ip: "9.1.2.1", eventId: "act_c" });
    expect(await t.query(api.entries.activity, { limit: 0 })).toEqual([]);
    expect(await t.query(api.entries.activity, { limit: -5 })).toEqual([]);
  });
});

describe("entryByHandle beyond the ranking cap", () => {
  it("finds active entries past BOARD_SCAN_CAP and reports them unranked", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < BOARD_SCAN_CAP + 1; i++) {
        await ctx.db.insert("entries", {
          handle: `acc${String(i).padStart(3, "0")}`,
          totalCents: 10_000_000 - i * UNIT_CENTS,
          bidCount: 1,
          clickCount: 0,
          status: "active",
          createdAt: now,
          lastBidAt: now,
        });
      }
    });

    const ranked = await t.query(api.entries.entryByHandle, { handle: "acc000" });
    expect(ranked?.rank).toBe(1);
    const unranked = await t.query(api.entries.entryByHandle, {
      handle: `acc${String(BOARD_SCAN_CAP).padStart(3, "0")}`,
    });
    expect(unranked?.totalCents).toBeGreaterThan(0);
    expect(unranked?.rank).toBeUndefined();

    const board = await t.query(api.entries.board, { limit: BOARD_SCAN_CAP + 100 });
    expect(board.length).toBeLessThanOrEqual(BOARD_SCAN_CAP);
  });
});

describe("admin removal", () => {
  it("requires the configured password and hides removed entries everywhere", async () => {
    process.env.ADMIN_PASSWORD = "hunter2";
    try {
      const t = setup();
      await pay(t, { handle: "badacc", amountCents: 500, ip: "7.7.7.1", eventId: "a1" });

      await expect(
        t.mutation(api.admin.findEntry, { password: "wrong", handle: "badacc" }),
      ).resolves.toBe("UNAUTHORIZED");

      const found = await t.mutation(api.admin.findEntry, {
        password: "hunter2",
        handle: "@BadAcc",
      });
      if (!found || typeof found === "string") throw new Error("entry not found");
      expect(found.handle).toBe("badacc");

      await expect(
        t.mutation(api.admin.removeEntry, {
          password: "hunter2",
          entryId: found.id,
        }),
      ).resolves.toBe("removed");

      const board = await t.query(api.entries.board, { limit: 10 });
      expect(board).toEqual([]);
      const activity = await t.query(api.entries.activity, { limit: 10 });
      expect(activity).toEqual([]);
      const stats = await t.query(api.entries.siteStats, {});
      expect(stats.paidCents).toBe(500); // money still counted; entry just hidden
    } finally {
      delete process.env.ADMIN_PASSWORD;
    }
  });

  it("persists wrong-password attempts until the shared limit is reached", async () => {
    process.env.ADMIN_PASSWORD = "hunter2";
    try {
      const t = setup();
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(
          t.mutation(api.admin.findEntry, {
            password: "wrong",
            handle: "anything",
          }),
        ).resolves.toBe("UNAUTHORIZED");
      }
      // Exhausted budget throttles further wrong guesses...
      await expect(
        t.mutation(api.admin.findEntry, {
          password: "wrong",
          handle: "anything",
        }),
      ).resolves.toBe("RATE_LIMITED");
      // ...but never locks out the correct password.
      await expect(
        t.mutation(api.admin.findEntry, {
          password: "hunter2",
          handle: "anything",
        }),
      ).resolves.toBe(null);
    } finally {
      delete process.env.ADMIN_PASSWORD;
    }
  });
});
