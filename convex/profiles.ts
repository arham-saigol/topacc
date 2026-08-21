import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { PROFILE_TTL_MS, TOP_PAGES_ENRICH_LIMIT } from "./shared";

/** Upsert cache row; merge non-null fields so failed lookups never clobber data. */
export const writeProfileCache = internalMutation({
  args: {
    handle: v.string(),
    fetchedAt: v.number(),
    avatarUrl: v.optional(v.string()),
    displayName: v.optional(v.string()),
    bio: v.optional(v.string()),
    verified: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("profileCache")
      .withIndex("by_handle", (q) => q.eq("handle", args.handle))
      .first();
    const patch: Partial<import("./_generated/dataModel").Doc<"profileCache">> = {
      fetchedAt: args.fetchedAt,
    };
    if (args.avatarUrl !== undefined && args.avatarUrl !== null) patch.avatarUrl = args.avatarUrl;
    if (args.displayName !== undefined && args.displayName !== null)
      patch.displayName = args.displayName;
    if (args.bio !== undefined && args.bio !== null) patch.bio = args.bio;
    if (args.verified !== undefined && args.verified !== null) patch.verified = args.verified;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("profileCache", {
        handle: args.handle,
        fetchedAt: args.fetchedAt,
        ...(patch.avatarUrl ? { avatarUrl: patch.avatarUrl } : {}),
        ...(patch.displayName ? { displayName: patch.displayName } : {}),
        ...(patch.bio ? { bio: patch.bio } : {}),
        ...(patch.verified !== undefined ? { verified: patch.verified } : {}),
      });
    }
    return null;
  },
});

/**
 * Hourly cron target: schedule enrichment for entries displayed on the first
 * pages whose cache is missing or older than ~7 days. Keeps provider volume
 * in the hundreds of calls per month.
 */
export const refreshDisplayedProfiles = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const displayed = await ctx.db
      .query("entries")
      .withIndex("by_status_and_total", (q) =>
        q.eq("status", "active").gt("totalCents", 0),
      )
      .order("desc")
      .take(TOP_PAGES_ENRICH_LIMIT);
    let scheduled = 0;
    for (const entry of displayed) {
      const cache = await ctx.db
        .query("profileCache")
        .withIndex("by_handle", (q) => q.eq("handle", entry.handle))
        .first();
      if (!cache || now - cache.fetchedAt > PROFILE_TTL_MS) {
        await ctx.scheduler.runAfter(0, internal.profiles_fetch.enrichEntry, {
          entryId: entry._id,
        });
        scheduled++;
      }
    }
    return scheduled;
  },
});
