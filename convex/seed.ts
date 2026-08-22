import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { canonicalizeHandle } from "../src/lib/handle";
import { UNIT_CENTS, isValidAmount } from "../src/lib/pricing";
import { bumpRevenue } from "./payments";

/**
 * Launch seeding: create entries with synthetic paid payments so the board
 * is never empty on day one. Run via:
 *   npx convex run seed:seedBoard '{"entries":[{"handle":"x","amountCents":500}]}'
 * Real profile data fills in via scheduled enrichment.
 */
export const seedBoard = internalMutation({
  args: {
    entries: v.array(v.object({ handle: v.string(), amountCents: v.number() })),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    let created = 0;
    for (const spec of args.entries) {
      const handle = canonicalizeHandle(spec.handle);
      if (!handle || !isValidAmount(spec.amountCents)) continue;
      const now = Date.now();
      const existing = await ctx.db
        .query("entries")
        .withIndex("by_handle", (q) => q.eq("handle", handle))
        .first();
      if (existing) continue; // already seeded; never double-count
      const entryId = await ctx.db.insert("entries", {
        handle,
        totalCents: 0,
        bidCount: 0,
        clickCount: 0,
        status: "active",
        createdAt: now,
        lastBidAt: now,
      });

      // Stagger timestamps so tie-breaks between equal totals are explicit.
      const occurredAt = now - created * 1000;
      await ctx.db.patch(entryId, {
        totalCents: spec.amountCents,
        bidCount: 1,
        lastBidAt: occurredAt,
      });
      await ctx.db.insert("payments", {
        entryId,
        amountCents: spec.amountCents,
        units: spec.amountCents / UNIT_CENTS,
        status: "paid",
        createdAt: occurredAt,
        paidAt: occurredAt,
      });
      // Seeded self-bids count as paid payments, like every other dollar.
      await bumpRevenue(ctx, spec.amountCents);
      created++;
    }
    return created;
  },
});
