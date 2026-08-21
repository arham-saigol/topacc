import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx, env } from "./_generated/server";
import { rateLimiter } from "./rateLimiter";
import { canonicalizeHandle } from "../src/lib/handle";

/**
 * Hidden /admin surface. Password-checked inside Convex (the only trust
 * boundary that matters here), lightly rate-limited against brute force.
 * Exactly two operations: find a handle, remove it from the board.
 */
async function assertAdmin(ctx: MutationCtx, password: unknown) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected || typeof password !== "string" || password !== expected) {
    throw new ConvexError("UNAUTHORIZED");
  }
  const limit = await rateLimiter.limit(ctx, "adminAttempt", { throws: false });
  if (!limit.ok) throw new ConvexError("RATE_LIMITED");
}

export const findEntry = mutation({
  args: { password: v.string(), handle: v.string() },
  returns: v.union(
    v.object({
      id: v.id("entries"),
      handle: v.string(),
      totalCents: v.number(),
      bidCount: v.number(),
      status: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.password);
    const handle = canonicalizeHandle(args.handle);
    if (!handle) return null;
    const entry = await ctx.db
      .query("entries")
      .withIndex("by_handle", (q) => q.eq("handle", handle))
      .first();
    if (!entry) return null;
    return {
      id: entry._id,
      handle: entry.handle,
      totalCents: entry.totalCents,
      bidCount: entry.bidCount,
      status: entry.status,
    };
  },
});

export const removeEntry = mutation({
  args: { password: v.string(), entryId: v.id("entries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertAdmin(ctx, args.password);
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.status === "removed") return null;
    await ctx.db.patch(entry._id, { status: "removed" });
    return null;
  },
});
