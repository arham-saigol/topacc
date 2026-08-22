import { v } from "convex/values";
import { mutation, type MutationCtx, env } from "./_generated/server";
import { rateLimiter } from "./rateLimiter";
import { canonicalizeHandle } from "../src/lib/handle";

/**
 * Hidden /admin surface. Password-checked inside Convex (the only trust
 * boundary that matters here). Successful admin operations are throttled by
 * a shared rate limit; password strength carries the brute-force weight.
 * Exactly two operations: find a handle, remove it from the board.
 */
async function adminError(
  ctx: MutationCtx,
  password: unknown,
): Promise<"RATE_LIMITED" | "UNAUTHORIZED" | null> {
  // Return failures instead of throwing: a throw would roll back the rate
  // limiter component write in this mutation and make wrong guesses free.
  const limit = await rateLimiter.limit(ctx, "adminAttempt", { throws: false });
  if (!limit.ok) return "RATE_LIMITED";
  const expected = env.ADMIN_PASSWORD;
  if (!expected || typeof password !== "string" || password !== expected) {
    return "UNAUTHORIZED";
  }
  return null;
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
    v.literal("RATE_LIMITED"),
    v.literal("UNAUTHORIZED"),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const error = await adminError(ctx, args.password);
    if (error) return error;
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
  returns: v.union(
    v.literal("removed"),
    v.literal("not_found"),
    v.literal("RATE_LIMITED"),
    v.literal("UNAUTHORIZED"),
  ),
  handler: async (ctx, args) => {
    const error = await adminError(ctx, args.password);
    if (error) return error;
    const entry = await ctx.db.get(args.entryId);
    if (!entry || entry.status === "removed") return "not_found";
    await ctx.db.patch(entry._id, { status: "removed" });
    return "removed";
  },
});
