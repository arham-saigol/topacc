"use node";

import { v } from "convex/values";
import { internalAction, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { avatarUrl as unavatarUrl } from "../src/lib/handle";

type XQuikUser = { name?: unknown; description?: unknown; verified?: unknown };

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Fetches everything displayed about an account. Never blocks submission,
 * payment handling, or rendering — failures resolve to nulls.
 *  - Avatar: unavatar.io (free).
 *  - Name/bio/verified: XQuik prepaid API; skipped entirely without a key.
 */
export const enrichEntry = internalAction({
  args: { entryId: v.id("entries") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const entry = await ctx.runQuery(internal.entries.entryHandleById, {
      entryId: args.entryId,
    });
    if (!entry) return null;
    const handle = entry.handle;

    let avatarUrl: string | null = null;
    try {
      // ?fallback=false makes unavatar answer 404 instead of serving a
      // placeholder, so we only cache genuinely resolvable avatars.
      const res = await fetch(`${unavatarUrl(handle)}?fallback=false`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) avatarUrl = unavatarUrl(handle);
    } catch {
      // network errors leave avatarUrl null; letter-avatar fallback renders
    }

    let displayName: string | null = null;
    let bio: string | null = null;
    let verified: boolean | undefined;
    const apiKey = env.XQUIK_API_KEY;
    if (apiKey) {
      try {
        const res = await fetch(`https://xquik.com/api/v1/x/users/${handle}`, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(10_000),
        });
        // 401/402/429 (bad key / no credits / rate limited) land here too:
        // keep existing cached values, store nulls otherwise.
        if (res.ok) {
          const user = (await res.json()) as XQuikUser;
          displayName = str(user.name);
          bio = str(user.description);
          if (typeof user.verified === "boolean") verified = user.verified;
        }
      } catch {
        // lookup failures must never surface to users
      }
    }

    await ctx.runMutation(internal.profiles.writeProfileCache, {
      handle,
      fetchedAt: Date.now(),
      ...(avatarUrl !== null ? { avatarUrl } : {}),
      ...(displayName !== null ? { displayName } : {}),
      ...(bio !== null ? { bio } : {}),
      ...(verified !== undefined ? { verified } : {}),
    });
    return null;
  },
});
