// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_BID_CENTS } from "@/lib/pricing";
import type { EntryRow } from "@/lib/types";

const entries = vi.hoisted((): EntryRow[] =>
  Array.from({ length: 51 }, (_, index) => ({
    id: `entry${index + 1}`,
    rank: index + 1,
    handle: `user${index + 1}`,
    totalCents: 2_500_000 - index * 500,
    bidCount: 1,
    clickCount: 0,
    lastBidAt: 1_700_000_000_000,
  })),
);

vi.mock("convex/react", () => ({
  useQuery: (_reference: unknown, args: { limit?: number }) => {
    if (args.limit === 100) return entries;
    if (args.limit === 8) return [];
    return { paidCents: 0 };
  },
  ConvexProvider: ({ children }: { children: React.ReactNode }) => children,
  ConvexReactClient: class {},
}));

import { Board } from "./board";

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_CONVEX_URL;
});

describe("Board", () => {
  it("caps Top 50 pagination at five pages", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    render(<Board />);

    fireEvent.click(screen.getByRole("button", { name: "Top 50" }));

    expect(screen.getByRole("button", { name: "5" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "6" })).toBeNull();
  });

  it("offers a staged checkout when taking the top rank exceeds the cap", () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    render(<Board />);

    const stagedCtas = screen.getAllByRole("button", {
      name: "Bid $25,000 toward top",
    });
    fireEvent.click(stagedCtas[0]);

    expect(
      screen.getByText(/Checkouts are capped at \$25,000.*boost the same handle/s),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Pay \$25,000/ })).toBeTruthy();
    expect(MAX_BID_CENTS).toBe(2_500_000);
  });
});
