"use client";

import Link from "next/link";
import { formatUsd, timeAgo } from "@/lib/format";
import { MAX_BID_CENTS } from "@/lib/pricing";

export function ClaimBar({
  priceToClaimTopCents,
  onClaim,
}: {
  priceToClaimTopCents: number;
  onClaim: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-edge bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="text-lg font-black tracking-tight">
          👑 topacc<span className="text-gold">.lol</span>
        </Link>
        <button
          type="button"
          onClick={onClaim}
          className="rounded-xl bg-gold px-4 py-2 text-sm font-black text-black transition hover:brightness-110 active:scale-95"
        >
          {priceToClaimTopCents > MAX_BID_CENTS
            ? `Bid ${formatUsd(MAX_BID_CENTS)} toward top`
            : `Claim top acc for ${formatUsd(priceToClaimTopCents)}`}
        </button>
      </div>
    </header>
  );
}

export function RevenueCounter({ paidCents }: { paidCents: number }) {
  return (
    <p className="text-center text-sm text-white/40">
      This site has made{" "}
      <span className="font-bold text-white/70">{formatUsd(paidCents)}</span> so far
    </p>
  );
}

export function ActivityFeed({
  items,
  now,
}: {
  items: Array<{ handle: string; amountCents: number; paidAt: number }>;
  now: number;
}) {
  if (items.length === 0) return null;
  return (
    <section aria-label="Latest bids" className="space-y-1.5">
      {items.map((item, i) => (
        <p key={`${item.handle}-${item.paidAt}-${i}`} className="text-sm text-white/50">
          <span className="font-semibold text-white/80">@{item.handle}</span>{" "}
          <span className="font-bold text-mint">+{formatUsd(item.amountCents)}</span>{" "}
          · {timeAgo(item.paidAt, now)} ago
        </p>
      ))}
    </section>
  );
}

export function Pagination({
  tabSize,
  onTabSize,
  page,
  pageCount,
  onPage,
}: {
  tabSize: number;
  onTabSize: (n: number) => void;
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  const btn =
    "rounded-lg px-2.5 py-1 text-sm font-bold transition disabled:opacity-30";
  return (
    <nav className="flex items-center justify-center gap-1.5">
      {[10, 50].map((size) => (
        <button
          key={size}
          type="button"
          onClick={() => {
            onTabSize(size);
            onPage(0);
          }}
          className={`${btn} ${tabSize === size ? "bg-gold text-black" : "bg-surface-2 text-white/60 hover:text-white"}`}
        >
          Top {size}
        </button>
      ))}
      {pageCount > 1 && (
        <>
          <span className="mx-1 h-5 w-px bg-edge" />
          <button
            type="button"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
            className={`${btn} bg-surface-2`}
            aria-label="Previous page"
          >
            ‹
          </button>
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPage(i)}
              className={`${btn} ${page === i ? "bg-white text-black" : "bg-surface-2 text-white/60"}`}
            >
              {i + 1}
            </button>
          ))}
          <button
            type="button"
            disabled={page >= pageCount - 1}
            onClick={() => onPage(page + 1)}
            className={`${btn} bg-surface-2`}
            aria-label="Next page"
          >
            ›
          </button>
        </>
      )}
    </nav>
  );
}
