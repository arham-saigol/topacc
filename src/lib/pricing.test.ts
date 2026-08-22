import { describe, expect, it } from "vitest";
import {
  CONFIRM_THRESHOLD_CENTS,
  MAX_BID_CENTS,
  UNIT_CENTS,
  boostPrice,
  isValidAmount,
  priceToBeatRank,
} from "./pricing";

describe("priceToBeatRank", () => {
  it("charges the $5 minimum to create an entry with no competition", () => {
    expect(priceToBeatRank(0)).toBe(500);
  });

  it("charges one increment above a round total", () => {
    // To strictly exceed $5 you must pay $10.
    expect(priceToBeatRank(500)).toBe(1000);
    expect(priceToBeatRank(2500)).toBe(3000);
  });

  it("rounds up to the next multiple when the target sits between increments", () => {
    // A $12.37 total (e.g. after a partial refund floor) needs $15 to beat.
    expect(priceToBeatRank(1237)).toBe(1500);
  });
});

describe("boostPrice", () => {
  it("covers exactly the gap in whole increments", () => {
    // At $5 vs a $12 target: two increments ($10) land at $15, clearing $12.
    expect(boostPrice(500, 1200)).toBe(1000);
    // Exact gap: $7 short of $12 -> one increment.
    expect(boostPrice(500, 1200 - 700)).toBe(500);
  });

  it("charges one increment beyond an exact-multiple gap", () => {
    // $5 vs a $15 target: paying exactly the $10 gap would only TIE, and a
    // tie keeps the earlier bidder's rank — so one more increment is due.
    expect(boostPrice(500, 1500)).toBe(1500);
    expect(boostPrice(500, 1000)).toBe(1000);
  });

  it("always charges at least one increment", () => {
    // Tied with the target: still must strictly exceed to take the rank.
    expect(boostPrice(1200, 1200)).toBe(500);
    expect(boostPrice(1300, 1200)).toBe(500);
  });
});

describe("isValidAmount", () => {
  it("accepts multiples of $5 up to the cap", () => {
    expect(isValidAmount(500)).toBe(true);
    expect(isValidAmount(MAX_BID_CENTS)).toBe(true);
  });

  it("rejects non-multiples, sub-minimum, over-cap, and non-positive amounts", () => {
    expect(isValidAmount(501)).toBe(false);
    expect(isValidAmount(499)).toBe(false);
    expect(isValidAmount(MAX_BID_CENTS + UNIT_CENTS)).toBe(false);
    expect(isValidAmount(0)).toBe(false);
    expect(isValidAmount(-500)).toBe(false);
  });

  it("caps and thresholds agree with the plan constants", () => {
    expect(UNIT_CENTS).toBe(500); // $5
    expect(CONFIRM_THRESHOLD_CENTS).toBe(50_000); // $500
    expect(MAX_BID_CENTS).toBe(2_500_000); // $25,000
  });
});
