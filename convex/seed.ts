import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { canonicalizeHandle } from "../src/lib/handle";

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
      if (!handle || spec.amountCents < 500 || spec.amountCents % 500 !== 0) continue;
      const now = Date.now();
      const existing = await ctx.db
        .query("entries")
        .withIndex("by_handle", (q) => q.eq("handle", handle))
        .first();
      const entryId =
        existing?._id ??
        (await ctx.db.insert("entries", {
          handle,
          totalCents: 0,
          bidCount: 0,
          clickCount: 0,
          status: "active",
          createdAt: now,
          lastBidAt: now,
        }));
      if (existing) continue; // already seeded; never double-count

      await ctx.db.patch(entryId, {
        totalCents: spec.amountCents,
        bidCount: 1,
        lastBidAt: now,
      });
      // Spread lastBidAt slightly so tie-breaks are deterministic.
      await ctx.db.insert("payments", {
        entryId,
        amountCents: spec.amountCents,
        units: spec.amountCents / 500,
        status: "paid",
        createdAt: now - created * 1000,
        paidAt: now - created * 1000,
      });
      created++;
    }
    return created;
  },
});
