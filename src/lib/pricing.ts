/**
 * Money mechanics. All amounts are integer cents; every payment is a
 * multiple of UNIT_CENTS ($5). See plans/topacc-lol-app-build.md.
 */
export const UNIT_CENTS = 500;
export const MAX_BID_CENTS = 2_500_000; // $25,000 cap on a single checkout
export const CONFIRM_THRESHOLD_CENTS = 50_000; // >$500 requires a confirm step

/** A valid bid: whole $5 increments, at least $5, at most $25,000. */
export function isValidAmount(amountCents: number): boolean {
  return (
    Number.isInteger(amountCents) &&
    amountCents >= UNIT_CENTS &&
    amountCents <= MAX_BID_CENTS &&
    amountCents % UNIT_CENTS === 0
  );
}

/**
 * Price for a NEW entry to take the rank currently held by an entry with
 * `targetTotalCents`: the smallest multiple of $5 strictly greater than
 * their total (ties keep the earlier bidder's rank).
 */
export function priceToBeatRank(targetTotalCents: number): number {
  return targetTotalCents - (targetTotalCents % UNIT_CENTS) + UNIT_CENTS;
}

/**
 * Price for an EXISTING entry with `myTotalCents` to reach a total that
 * beats `targetTotalCents`. Always at least one increment — a tie does not
 * take the rank.
 */
export function boostPrice(myTotalCents: number, targetTotalCents: number): number {
  const gap = Math.max(targetTotalCents - myTotalCents, 0);
  const units = Math.max(Math.ceil(gap / UNIT_CENTS), 1);
  return units * UNIT_CENTS;
}

/**
 * Rank an entry lands at after its payment confirms. Its lastBidAt becomes
 * "now", so every current entry with an equal total stays ahead of it until
 * they bid again — hence counting equals as ahead.
 */
export function projectedRank(
  entries: ReadonlyArray<{ totalCents: number }>,
  projectedTotalCents: number,
): number {
  let ahead = 0;
  for (const e of entries) {
    if (e.totalCents >= projectedTotalCents) ahead++;
  }
  return ahead + 1;
}

/**
 * Board ordering: total descending, ties broken by EARLIER lastBidAt
 * (first to reach a total holds the rank).
 */
export function compareEntries(
  a: { totalCents: number; lastBidAt: number },
  b: { totalCents: number; lastBidAt: number },
): number {
  if (a.totalCents !== b.totalCents) return b.totalCents - a.totalCents;
  return a.lastBidAt - b.lastBidAt;
}
