// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { EntryRow } from "@/lib/types";
import { BidModal } from "./bid-modal";

const entries: EntryRow[] = [];

function ParentWithClock() {
  const [open, setOpen] = useState(false);
  const [, setNow] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow((now) => now + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open bid
      </button>
      {open && (
        <BidModal
          target={{ kind: "new", suggestedCents: 500 }}
          entries={entries}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("keeps focus in the open modal when the parent clock rerenders", () => {
  vi.useFakeTimers();
  render(<ParentWithClock />);

  fireEvent.click(screen.getByRole("button", { name: "Open bid" }));
  const input = screen.getByPlaceholderText("@username");
  input.focus();
  expect(document.activeElement).toBe(input);

  act(() => vi.advanceTimersByTime(30_000));

  expect(document.activeElement).toBe(input);
  expect(input.closest('[role="dialog"]')).not.toBeNull();
});
