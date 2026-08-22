"use client";

import type { EntryRow } from "@/lib/types";
import { VerifiedBadge } from "@/lib/types";
import { formatUsd, timeAgo } from "@/lib/format";
import { Avatar } from "./avatar";

/** Click-tracked profile link: counts, then bounces to x.com. */
export function ProfileLink({
  entry,
  siteUrl,
  className = "",
  children,
}: {
  entry: Pick<EntryRow, "id" | "handle">;
  siteUrl: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={`${siteUrl}/api/c/${entry.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  );
}

function NameLine({
  entry,
}: {
  entry: Pick<EntryRow, "handle" | "displayName" | "verified">;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate font-semibold">
        {entry.displayName ?? `@${entry.handle}`}
      </span>
      {entry.verified && <VerifiedBadge />}
      <span className="truncate text-sm text-white/40">@{entry.handle}</span>
    </span>
  );
}

export function EntryRowItem({
  entry,
  claimPriceCents,
  onClaim,
  siteUrl,
}: {
  entry: EntryRow;
  claimPriceCents: number;
  onClaim: (target: EntryRow) => void;
  siteUrl: string;
}) {
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-edge bg-surface p-3">
      <div className="w-8 shrink-0 text-center text-lg font-bold text-white/30">
        {entry.rank}
      </div>
      <ProfileLink entry={entry} siteUrl={siteUrl} className="shrink-0">
        <Avatar handle={entry.handle} size={44} />
      </ProfileLink>
      <ProfileLink entry={entry} siteUrl={siteUrl} className="min-w-0 flex-1 leading-tight">
        <NameLine entry={entry} />
        {entry.bio && (
          <span className="mt-0.5 block truncate text-sm text-white/50">{entry.bio}</span>
        )}
        <span className="mt-0.5 block text-xs text-white/35">
          {formatUsd(entry.totalCents)} · {entry.clickCount.toLocaleString()} clicks ·{" "}
          {timeAgo(entry.lastBidAt)} ago
        </span>
      </ProfileLink>
      <button
        type="button"
        onClick={() => onClaim(entry)}
        className="shrink-0 rounded-xl bg-surface-2 px-3 py-2 text-sm font-bold text-gold transition hover:brightness-125 active:scale-95"
      >
        Claim #{entry.rank} for {formatUsd(claimPriceCents)}
      </button>
    </li>
  );
}

export function HeroCard({
  entry,
  claimPriceCents,
  onClaim,
  siteUrl,
}: {
  entry: EntryRow;
  claimPriceCents: number;
  onClaim: (target: EntryRow) => void;
  siteUrl: string;
}) {
  return (
    <section className="rounded-3xl border border-gold/30 bg-gradient-to-b from-gold/10 to-transparent p-5 text-center">
      <div className="text-4xl">👑</div>
      <div className="mt-1 text-xs font-bold tracking-[0.2em] text-gold uppercase">
        #1 most valued acc
      </div>
      <ProfileLink
        entry={entry}
        siteUrl={siteUrl}
        className="mx-auto mt-4 flex w-fit items-center gap-3 text-left"
      >
        <Avatar handle={entry.handle} size={64} />
        <span className="leading-tight">
          <span className="flex items-center gap-1.5 text-xl font-extrabold">
            {entry.displayName ?? `@${entry.handle}`}
            {entry.verified && <VerifiedBadge />}
          </span>
          <span className="block text-white/40">@{entry.handle}</span>
          {entry.bio && (
            <span className="mt-1 block max-w-xs truncate text-sm text-white/50">
              {entry.bio}
            </span>
          )}
        </span>
      </ProfileLink>
      <div className="mt-4 text-5xl font-black tracking-tight">
        {formatUsd(entry.totalCents)}
      </div>
      <div className="mt-1 flex justify-center gap-4 text-xs text-white/40">
        <span>{entry.bidCount} bids</span>
        <span>{entry.clickCount.toLocaleString()} clicks</span>
        <span>last bid {timeAgo(entry.lastBidAt)} ago</span>
      </div>
      <button
        type="button"
        onClick={() => onClaim(entry)}
        className="mt-4 rounded-xl bg-mint px-5 py-2.5 font-bold text-black transition hover:brightness-110 active:scale-95"
      >
        Take #1 for {formatUsd(claimPriceCents)}
      </button>
      <p className="mt-2 text-[11px] text-white/30">
        Ties don&apos;t win — you must strictly beat the total.
      </p>
    </section>
  );
}
