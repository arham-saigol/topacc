"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { formatUsd } from "@/lib/format";

function SuccessBody() {
  const ref = useSearchParams().get("ref");

  const payment = useQuery(
    api.payments.publicPaymentStatus,
    ref ? { paymentId: ref as Id<"payments"> } : "skip",
  );

  if (!ref) {
    return (
      <Center>
        <h1 className="text-2xl font-black">Nothing to see here.</h1>
        <p className="mt-2 text-white/50">
          This page confirms a payment. Start by picking a handle on the board.
        </p>
        <BackButton label="Claim your rank" />
      </Center>
    );
  }
  if (payment === undefined) {
    return (
      <Center>
        <p className="animate-pulse text-white/50">Checking payment…</p>
      </Center>
    );
  }
  if (payment === null) {
    return (
      <Center>
        <h1 className="text-2xl font-black">Payment not found.</h1>
        <BackButton />
      </Center>
    );
  }

  if (payment.status === "pending") {
    return (
      <Center>
        <div className="text-5xl">⏳</div>
        <h1 className="mt-3 text-2xl font-black">
          {formatUsd(payment.amountCents)} received — confirming…
        </h1>
        <p className="mt-2 text-white/50">
          This usually takes a few seconds. The board updates live; keep this
          page open.
        </p>
      </Center>
    );
  }
  if (payment.status === "expired") {
    return (
      <Center>
        <div className="text-5xl">💤</div>
        <h1 className="mt-3 text-2xl font-black">Checkout expired unpaid.</h1>
        <p className="mt-2 text-white/50">Nothing was charged. Try again anytime.</p>
        <BackButton />
      </Center>
    );
  }

  if (payment.status === "refunded") {
    return (
      <Center>
        <h1 className="text-2xl font-black">This payment was refunded.</h1>
        <BackButton />
      </Center>
    );
  }

  // paid — celebrate with share
  return (
    <Center>
      <div className="text-5xl">🎉</div>
      <h1 className="mt-3 text-2xl font-black">
        @{payment.handle ?? "your acc"} is funded with{" "}
        {formatUsd(payment.amountCents)}
      </h1>
      <p className="mt-2 text-white/50">
        The board already reflects your money. Share it:
      </p>
      {payment.handle && (
        <a
          href={`https://x.com/intent/tweet?text=${encodeURIComponent(
            `I just paid to rank @${payment.handle} on topacc.lol 👑`,
          )}&url=${encodeURIComponent(`https://topacc.lol/v/${payment.handle}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 rounded-xl bg-[#1d9bf0] px-5 py-2.5 font-bold text-white transition hover:brightness-110"
        >
          Post on X
        </a>
      )}
      <BackButton />
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-md px-4 pt-24 text-center">{children}</main>;
}

function BackButton({ label = "Back to the board" }: { label?: string }) {
  return (
    <a
      href="/"
      className="mt-6 inline-block rounded-xl bg-surface-2 px-4 py-2 font-bold transition hover:brightness-125"
    >
      ← {label}
    </a>
  );
}

export default function SuccessPage() {
  return (
    <Suspense fallback={<Center><p className="text-white/40">Loading…</p></Center>}>
      <SuccessBody />
    </Suspense>
  );
}
