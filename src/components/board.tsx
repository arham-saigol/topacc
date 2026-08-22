"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { priceToBeatRank } from "@/lib/pricing";
import { BidModal, type BidTarget } from "./bid-modal";
import { HeroCard, EntryRowItem } from "./entry-card";
import { ActivityFeed, ClaimBar, Pagination, RevenueCounter } from "./board-parts";
import { convexSiteUrl } from "./providers";

const PAGE_SIZE = 10;
/** Ranking ceiling documented in convex/entries.ts (BOARD_SCAN_CAP = 500). */
const FETCH_LIMIT = 100;

export function Board() {
  const [tabSize, setTabSize] = useState(10);
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<BidTarget | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const entries = useQuery(api.entries.board, { limit: FETCH_LIMIT });
  const activity = useQuery(api.entries.activity, { limit: 8 });
  const stats = useQuery(api.entries.siteStats, {});

  // Keep relative timestamps fresh without polling the backend.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const siteUrl = convexSiteUrl();
  const list = entries ?? [];
  const top = list[0];
  // Price for a NEW entrant to take #1 (strictly beat the current total).
  const claimTopPrice = top ? priceToBeatRank(top.totalCents) : 500;

  const pageCount =
    tabSize === 10 ? 1 : Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageEntries = list.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  function openClaim(target: BidTarget) {
    setModal(target);
  }

  return (
    <div className="min-h-dvh pb-24">
      <ClaimBar
        priceToClaimTopCents={claimTopPrice}
        onClaim={() => openClaim({ kind: "new", suggestedCents: claimTopPrice })}
      />

      <main className="mx-auto max-w-2xl space-y-5 px-4 pt-5">
        {!entries && (
          <p className="pt-20 text-center text-white/40">Loading the board…</p>
        )}

        {entries && !top && (
          <section className="rounded-3xl border border-edge bg-surface p-8 text-center">
            <div className="text-5xl">👑</div>
            <h1 className="mt-3 text-2xl font-black">
              The board is empty. Money decides.
            </h1>
            <button
              type="button"
              onClick={() => openClaim({ kind: "new", suggestedCents: 500 })}
              className="mt-4 rounded-xl bg-gold px-5 py-2.5 font-black text-black transition hover:brightness-110 active:scale-95"
            >
              Be #1 for $5
            </button>
          </section>
        )}

        {top && (
          <>
            <HeroCard
              entry={top}
              claimPriceCents={claimTopPrice}
              // Claim buttons challenge the advertised rank with a NEW
              // entry — passing the incumbent would boost it instead.
              onClaim={() => openClaim({ kind: "new", suggestedCents: claimTopPrice })}
              siteUrl={siteUrl}
            />

            <ol className="space-y-2">
              {pageEntries
                .filter((e) => e.rank !== 1)
                .map((entry) => {
                  const claimPrice = priceToBeatRank(entry.totalCents);
                  return (
                    <EntryRowItem
                      key={entry.id}
                      entry={entry}
                      claimPriceCents={claimPrice}
                      onClaim={() => openClaim({ kind: "new", suggestedCents: claimPrice })}
                      siteUrl={siteUrl}
                    />
                  );
                })}
            </ol>

            <Pagination
              tabSize={tabSize}
              onTabSize={setTabSize}
              page={safePage}
              pageCount={pageCount}
              onPage={setPage}
            />
          </>
        )}

        {activity && activity.length > 0 && (
          <ActivityFeed items={activity} now={now} />
        )}
        {stats && <RevenueCounter paidCents={stats.paidCents} />}
      </main>

      {modal && (
        <BidModal
          target={modal}
          entries={list}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
