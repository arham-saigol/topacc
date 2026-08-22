import { v } from "convex/values";
import { internalMutation, internalQuery, query, type QueryCtx } from "./_generated/server";
import { compareEntries } from "../src/lib/pricing";
import { canonicalizeHandle } from "../src/lib/handle";
import { ACTIVITY_FETCH_MAX, BOARD_SCAN_CAP } from "./shared";

/** Shape returned by board/byHandle. Rank is 1-based. */
const entryRow = {
  id: v.id("entries"),
  rank: v.optional(v.number()),
  handle: v.string(),
  displayName: v.optional(v.string()),
  bio: v.optional(v.string()),
  verified: v.optional(v.boolean()),
  avatarUrl: v.optional(v.string()),
  totalCents: v.number(),
  bidCount: v.number(),
  clickCount: v.number(),
  lastBidAt: v.number(),
};

async function loadRankedActive(ctx: QueryCtx) {
  // Ceiling: ranking considers at most BOARD_SCAN_CAP active entries. The
  // index gives totalCents desc; ties are re-sorted by earlier lastBidAt in
  // JS because a single index cannot order two fields oppositely.
  // Entries are created when a checkout starts, so visibility requires a
  // paid total — abandoned/expired checkouts and full refunds never show.
  const top = await ctx.db
    .query("entries")
    .withIndex("by_status_and_total", (q) =>
      q.eq("status", "active").gt("totalCents", 0),
    )
    .order("desc")
    .take(BOARD_SCAN_CAP);
  top.sort(compareEntries);
  return top;
}

async function toRow(
  ctx: QueryCtx,
  entry: import("./_generated/dataModel").Doc<"entries">,
  rank?: number,
) {
  const profile = await ctx.db
    .query("profileCache")
    .withIndex("by_handle", (q) => q.eq("handle", entry.handle))
    .first();
  // Optional fields may be undefined; the validator allows it and JSON
  // serialization drops them before they reach clients.
  return {
    id: entry._id,
    rank,
    handle: entry.handle,
    displayName: profile?.displayName,
    bio: profile?.bio,
    verified: profile?.verified === true ? true : undefined,
    avatarUrl: profile?.avatarUrl,
    totalCents: entry.totalCents,
    bidCount: entry.bidCount,
    clickCount: entry.clickCount,
    lastBidAt: entry.lastBidAt,
  };
}

export const board = query({
  args: { limit: v.number() },
  returns: v.array(v.object(entryRow)),
  handler: async (ctx, args) => {
    const ranked = await loadRankedActive(ctx);
    return Promise.all(
      ranked.slice(0, Math.min(Math.max(args.limit, 0), BOARD_SCAN_CAP)).map((entry, i) =>
        toRow(ctx, entry, i + 1),
      ),
    );
  },
});

export const entryByHandle = query({
  args: { handle: v.string() },
  returns: v.union(v.object(entryRow), v.null()),
  handler: async (ctx, args) => {
    // Load the entry directly so active entries beyond BOARD_SCAN_CAP are
    // still found; rank comes from the ranked scan when it fits inside it.
    const handle = canonicalizeHandle(args.handle);
    if (!handle) return null;
    const entry = await ctx.db
      .query("entries")
      .withIndex("by_handle", (q) => q.eq("handle", handle))
      .first();
    if (!entry || entry.status !== "active" || entry.totalCents <= 0) return null;
    const ranked = await loadRankedActive(ctx);
    const idx = ranked.findIndex((e) => e._id === entry._id);
    return toRow(ctx, entry, idx === -1 ? undefined : idx + 1);
  },
});

export const siteStats = query({
  args: {},
  returns: v.object({ paidCents: v.number() }),
  handler: async (ctx) => {
    const row = await ctx.db.query("siteStats").first();
    return { paidCents: row?.paidCents ?? 0 };
  },
});

export const activity = query({
  args: { limit: v.number() },
  returns: v.array(
    v.object({
      handle: v.string(),
      amountCents: v.number(),
      paidAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(args.limit, 0);
    // Feed shows latest payment EVENTS; order by paidAt (when the money
    // landed), not createdAt (when checkout started) — a checkout pending
    // for hours must not sort behind older bids.
    const recent = await ctx.db
      .query("payments")
      .withIndex("by_status_paid", (q) => q.eq("status", "paid"))
      .order("desc")
      .take(ACTIVITY_FETCH_MAX);
    const out = [];
    for (const p of recent) {
      if (out.length >= limit) break;
      const entry = await ctx.db.get(p.entryId);
      if (!entry || entry.status !== "active") continue;
      out.push({ handle: entry.handle, amountCents: p.amountCents, paidAt: p.paidAt ?? p.createdAt });
    }
    return out;
  },
});

/** Internal read used by the enrichment action ("use node" can't share ctx.db). */
export const entryHandleById = internalQuery({
  args: { entryId: v.id("entries") },
  returns: v.union(v.object({ handle: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    return entry ? { handle: entry.handle } : null;
  },
});

/** Click-tracker target: increment transactionally, then redirect. */
export const registerClick = internalMutation({
  args: { entryId: v.id("entries") },
  returns: v.union(v.object({ handle: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.status !== "active") return null;
    await ctx.db.patch(entry._id, { clickCount: entry.clickCount + 1 });
    return { handle: entry.handle };
  },
});
