import { describe, expect, it } from "vitest";
import { formatUsd, timeAgo } from "./format";

describe("formatUsd", () => {
  it("renders whole-dollar totals without cents", () => {
    // $2,500 in cents.
    expect(formatUsd(250_000)).toBe("$2,500");
    expect(formatUsd(500)).toBe("$5");
  });

  it("keeps cents for non-whole dollars", () => {
    expect(formatUsd(1237)).toBe("$12.37");
  });
});

describe("timeAgo", () => {
  const now = 1_700_000_000_000;

  it("buckets elapsed time into s/m/h/d against an explicit clock", () => {
    expect(timeAgo(now - 30_000, now)).toBe("30s");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m");
    expect(timeAgo(now - 3 * 60 * 60_000, now)).toBe("3h");
    expect(timeAgo(now - 26 * 60 * 60_000, now)).toBe("1d");
  });

  it("never reports zero or negative durations", () => {
    expect(timeAgo(now + 60_000, now)).toBe("1s");
  });
});
