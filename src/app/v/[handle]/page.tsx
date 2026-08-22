import type { Metadata } from "next";
import Link from "next/link";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import { canonicalizeHandle, avatarUrl } from "@/lib/handle";
import { formatUsd } from "@/lib/format";
import { PermalinkCard } from "@/components/permalink-card";

async function fetchEntry(handle: string) {
  try {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    const client = new ConvexHttpClient(url);
    return await client.query(api.entries.entryByHandle, { handle });
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle: raw } = await params;
  const handle = canonicalizeHandle(raw);
  const entry = handle ? await fetchEntry(handle) : null;

  const title =
    entry && entry.rank
      ? `${entry.displayName ?? `@${entry.handle}`} (@${entry.handle}) is #${entry.rank} on topacc.lol — ${formatUsd(entry.totalCents)}`
      : `@${handle ?? raw} on topacc.lol`;
  const description = entry?.bio
    ? `${entry.bio.slice(0, 160)}`
    : "The most valued accounts on X, decided by money.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [avatarUrl(handle ?? "topacc")],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [avatarUrl(handle ?? "topacc")],
    },
  };
}

export default async function PermalinkPage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const { handle: raw } = await params;
  const handle = canonicalizeHandle(raw);
  const initialEntry = handle ? await fetchEntry(handle) : null;

  if (!handle) {
    return (
      <main className="mx-auto max-w-md px-4 pt-24 text-center">
        <h1 className="text-2xl font-black">Not a valid X handle.</h1>
        <Link href="/" className="mt-4 inline-block font-bold text-gold">
          ← back to the board
        </Link>
      </main>
    );
  }

  return (
    <PermalinkCard
      handle={handle}
      siteUrl={process.env.NEXT_PUBLIC_CONVEX_URL?.replace(/\.convex\.cloud$/, ".convex.site") ?? ""}
      initialEntry={initialEntry}
    />
  );
}
