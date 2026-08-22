"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { EntryRow } from "@/lib/types";
import { VerifiedBadge } from "@/lib/types";
import { formatUsd, timeAgo } from "@/lib/format";
import { Avatar } from "./avatar";

/** Live permalink card for one account (subscribes like the board). */
export function PermalinkCard({
  handle,
  siteUrl,
  initialEntry,
}: {
  handle: string;
  siteUrl: string;
  initialEntry: EntryRow | null;
}) {
  const live = useQuery(api.entries.entryByHandle, { handle });
  const entry = live === undefined ? initialEntry : live;

  if (!entry) {
    return (
      <main className="mx-auto max-w-md px-4 pt-24 text-center">
        <Avatar handle={handle} size={72} className="mx-auto" />
        <h1 className="mt-4 text-2xl font-black">@{handle} isn&apos;t ranked yet.</h1>
        <p className="mt-2 text-white/50">Someone could fix that for $5.</p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-xl bg-gold px-5 py-2.5 font-black text-black transition hover:brightness-110"
        >
          Claim @{handle}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-16">
      <Link href="/" className="text-lg font-black tracking-tight">
        👑 topacc<span className="text-gold">.lol</span>
      </Link>
      <section className="mt-6 rounded-3xl border border-edge bg-surface p-6 text-center">
        <div className="text-xs font-bold tracking-[0.2em] text-gold uppercase">
          Rank #{entry.rank ?? "—"} on X
        </div>
        <a
          href={`${siteUrl}/api/c/${entry.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-auto mt-4 flex w-fit items-center gap-3"
        >
          <Avatar handle={handle} size={64} />
          <span className="leading-tight">
            <span className="flex items-center gap-1.5 text-xl font-extrabold">
              {entry.displayName ?? `@${handle}`}
              {entry.verified && <VerifiedBadge />}
            </span>
            <span className="block text-white/40">@{handle}</span>
          </span>
        </a>
        {entry.bio && (
          <p className="mx-auto mt-3 max-w-xs truncate text-sm text-white/50">
            {entry.bio}
          </p>
        )}
        <div className="mt-4 text-5xl font-black tracking-tight">
          {formatUsd(entry.totalCents)}
        </div>
        <p className="mt-1 text-xs text-white/40">
          {entry.clickCount.toLocaleString()} clicks · last bid{" "}
          {timeAgo(entry.lastBidAt)} ago
        </p>
      </section>
      <p className="mt-4 text-center text-sm text-white/40">
        Think this account deserves a higher rank? Money decides.
      </p>
    </main>
  );
}
