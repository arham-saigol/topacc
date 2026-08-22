"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CONFIRM_THRESHOLD_CENTS,
  MAX_BID_CENTS,
  UNIT_CENTS,
  boostPrice,
  isValidAmount,
  projectedRank,
} from "@/lib/pricing";
import { canonicalizeHandle } from "@/lib/handle";
import { formatUsd } from "@/lib/format";
import type { EntryRow } from "@/lib/types";
import { VerifiedBadge } from "@/lib/types";
import { Avatar } from "./avatar";
import { convexSiteUrl } from "./providers";

export type BidTarget =
  | { kind: "new"; suggestedCents: number }
  | { kind: "entry"; entry: EntryRow };

/**
 * One modal for claiming a fresh rank and boosting an existing entry.
 * Typing previews the avatar live via unavatar.io (free path only).
 */
export function BidModal({
  target,
  entries,
  onClose,
}: {
  target: BidTarget;
  entries: EntryRow[];
  onClose: () => void;
}) {
  const [handleInput, setHandleInput] = useState(
    target.kind === "entry" ? `@${target.entry.handle}` : "",
  );
  const [debounced, setDebounced] = useState(handleInput);
  const [amount, setAmount] = useState(
    target.kind === "entry" ? UNIT_CENTS : target.suggestedCents,
  );
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ~400ms debounce drives the avatar preview only — lookup and checkout
  // always use what is currently typed so edits are never submitted stale.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(handleInput), 400);
    return () => clearTimeout(id);
  }, [handleInput]);

  const handle = useMemo(() => canonicalizeHandle(handleInput), [handleInput]);
  const previewHandle = useMemo(() => canonicalizeHandle(debounced), [debounced]);
  // Subject derives ONLY from what's currently typed — editing the handle
  // naturally switches between new-entry and boost mode.
  const subject = useMemo(
    () => (handle ? entries.find((e) => e.handle === handle) : undefined),
    [handle, entries],
  );
  const isBoost = subject !== undefined;

  // Minimum acceptable bid for the current situation.
  const minAmount = useMemo(() => {
    if (subject) {
      // Beat the entry directly above; rank 1 just needs one increment.
      const above = subject.rank !== undefined ? entries[subject.rank - 2] : undefined;
      return boostPrice(subject.totalCents, above?.totalCents ?? subject.totalCents);
    }
    return UNIT_CENTS;
  }, [subject, entries]);

  const effectiveAmount = Math.max(amount, minAmount);
  const projectedTotal =
    (subject?.totalCents ?? 0) + effectiveAmount;
  const wouldLandAt = projectedRank(entries, projectedTotal);

  function step(deltaUnits: number) {
    setConfirming(false);
    setError(null);
    setAmount((a) =>
      Math.min(MAX_BID_CENTS, Math.max(UNIT_CENTS, a + deltaUnits * UNIT_CENTS)),
    );
  }

  async function submit() {
    if (!handle) {
      setError("Enter a valid X handle (letters, numbers, underscores).");
      return;
    }
    if (!isValidAmount(effectiveAmount)) {
      setError("Pick an amount between $5 and $25,000 in $5 steps.");
      return;
    }
    if (effectiveAmount > CONFIRM_THRESHOLD_CENTS && !confirming) {
      setConfirming(true);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${convexSiteUrl()}/api/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle, amountCents: effectiveAmount }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        checkoutUrl?: string;
        error?: string;
        retryAfterSeconds?: number;
      };
      if (res.ok && data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }
      setError(
        data.error === "rate_limited"
          ? "Too many attempts from your network — try again later."
          : data.error === "entry_removed"
            ? "That account was removed from the board."
            : data.error === "invalid_handle"
              ? "That doesn't look like a valid X handle."
              : "Couldn't start checkout. Try again.",
      );
    } catch {
      setError("Network hiccup — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const needsConfirm = effectiveAmount > CONFIRM_THRESHOLD_CENTS;

  // Modal semantics: Escape closes, Tab stays inside, and closing returns
  // focus to the trigger. Captured during render so autoFocus hasn't moved
  // it into the dialog yet.
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(() => {
    const restoreTo = previouslyFocused.current;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        "button, input, [href], [tabindex]:not([tabindex='-1'])",
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreTo?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bid-modal-heading"
        className="w-full max-w-md rounded-3xl border border-edge bg-surface p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h2 id="bid-modal-heading" className="text-xl font-extrabold">
            {isBoost ? `Boost @${subject?.handle}` : "Claim a rank"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg px-2 py-1 text-white/40 transition hover:bg-surface-2 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Handle input with embedded live avatar preview */}
        <label className="mt-4 block">
          <span className="text-xs font-bold tracking-wider text-white/40 uppercase">
            X handle
          </span>
          <div className="mt-1 flex items-center gap-2 rounded-2xl border border-edge bg-bg px-3 focus-within:border-gold/60">
            <AvatarPreview handle={previewHandle} />
            <input
              autoFocus
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={16}
              placeholder="@username"
              value={handleInput}
              onChange={(e) => {
                setHandleInput(e.target.value);
                setConfirming(false);
                setError(null);
              }}
              className="w-full bg-transparent py-3 font-semibold outline-none placeholder:text-white/25"
            />
          </div>
        </label>

        {/* Existing entry summary */}
        {subject && (
          <div className="mt-3 flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
            <Avatar handle={subject.handle} size={36} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex items-center gap-1 truncate font-semibold">
                {subject.displayName ?? `@${subject.handle}`}
                {subject.verified && <VerifiedBadge />}
              </div>
              <div className="text-xs text-white/40">
                #{subject.rank} · {formatUsd(subject.totalCents)}
              </div>
            </div>
          </div>
        )}

        {/* Amount stepper */}
        <div className="mt-4">
          <span className="text-xs font-bold tracking-wider text-white/40 uppercase">
            Your bid
          </span>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease $5"
              onClick={() => step(-1)}
              disabled={effectiveAmount <= UNIT_CENTS}
              className="h-12 w-12 rounded-2xl bg-surface-2 text-2xl font-bold disabled:opacity-30"
            >
              −
            </button>
            <div className="flex h-12 flex-1 items-center justify-center rounded-2xl border border-edge bg-bg text-2xl font-black">
              {formatUsd(effectiveAmount)}
            </div>
            <button
              type="button"
              aria-label={`Increase $${UNIT_CENTS / 100}`}
              onClick={() => step(1)}
              disabled={effectiveAmount >= MAX_BID_CENTS}
              className="h-12 w-12 rounded-2xl bg-surface-2 text-2xl font-bold disabled:opacity-30"
            >
              +
            </button>
          </div>
        </div>

        {/* Live projection */}
        {!error && (
          <p className="mt-3 text-sm text-mint">
            You&apos;d land at <strong>#{wouldLandAt}</strong> with{" "}
            {formatUsd(projectedTotal)}
            {isBoost && subject ? ` on @${subject.handle}` : ""}
          </p>
        )}
        {needsConfirm && !confirming && (
          <p className="mt-1 text-xs text-gold">
            Big money — you&apos;ll get one confirmation step.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="mt-4 w-full rounded-2xl bg-gold py-3.5 text-lg font-black text-black transition hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
        >
          {submitting
            ? "Opening checkout…"
            : confirming
              ? `Confirm ${formatUsd(effectiveAmount)}`
              : isBoost
                ? `Add ${formatUsd(effectiveAmount)}`
                : `Pay ${formatUsd(effectiveAmount)} to claim #${wouldLandAt}`}
        </button>
        <p className="mt-2 text-center text-[11px] text-white/30">
          Secure checkout by Creem · cards accepted worldwide
        </p>
      </div>
    </div>
  );
}

function AvatarPreview({ handle }: { handle: string | null }) {
  return (
    <span className="shrink-0">
      {handle ? (
        <Avatar handle={handle} size={28} />
      ) : (
        <span className="inline-block h-7 w-7 rounded-full bg-surface-2" />
      )}
    </span>
  );
}
