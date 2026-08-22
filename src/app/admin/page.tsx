"use client";

import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

type FoundEntry = {
  id: Id<"entries">;
  handle: string;
  totalCents: number;
  bidCount: number;
  status: string;
};

/** Hidden admin: password-gated handle removal. Nothing else. */
export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundEntry | null | undefined>(undefined);
  const [message, setMessage] = useState<string | null>(null);

  // Restore the remembered password after mount (client only; sessionStorage
  // is unavailable during SSR, so it cannot initialize state directly).
  useEffect(() => {
    const saved = sessionStorage.getItem("topacc-admin");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (saved) setPassword(saved);
  }, []);

  const findEntry = useMutation(api.admin.findEntry);
  const removeEntry = useMutation(api.admin.removeEntry);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      sessionStorage.setItem("topacc-admin", password);
      const result = await findEntry({ password, handle: query });
      setFound(result ?? null);
    } catch (err) {
      setFound(undefined);
      setMessage(err instanceof Error ? err.message.replace("Error:", "").trim() : "Failed");
    }
  }

  async function remove() {
    if (!found) return;
    try {
      await removeEntry({ password, entryId: found.id });
      setMessage(`@${found.handle} removed from the board.`);
      setFound(undefined);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to remove");
    }
  }

  return (
    <main className="mx-auto max-w-md px-4 pt-16">
      <h1 className="text-xl font-black">🛠 admin</h1>

      <form onSubmit={search} className="mt-6 space-y-3">
        <label className="block sr-only" htmlFor="admin-password">
          Admin password
        </label>
        <input
          id="admin-password"
          type="password"
          placeholder="admin password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-2xl border border-edge bg-bg px-4 py-3 outline-none focus:border-gold/60"
        />
        <label className="block sr-only" htmlFor="admin-handle">
          Handle to find
        </label>
        <input
          id="admin-handle"
          type="text"
          placeholder="@handle to find"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-2xl border border-edge bg-bg px-4 py-3 outline-none focus:border-gold/60"
        />
        <button
          type="submit"
          className="w-full rounded-2xl bg-surface-2 py-3 font-bold transition hover:brightness-125"
        >
          Search
        </button>
      </form>

      {message && <p className="mt-4 text-sm text-white/60">{message}</p>}

      {found && (
        <div className="mt-6 rounded-2xl border border-edge bg-surface p-4">
          <p className="font-bold">@{found.handle}</p>
          <p className="text-sm text-white/50">
            ${(found.totalCents / 100).toLocaleString()} · {found.bidCount} bids ·{" "}
            {found.status}
          </p>
          {found.status === "active" && (
            <button
              type="button"
              onClick={remove}
              className="mt-3 w-full rounded-xl bg-red-500/90 py-2.5 font-bold text-white transition hover:bg-red-500"
            >
              Remove from board
            </button>
          )}
        </div>
      )}

      {found === null && (
        <p className="mt-4 text-sm text-white/40">No entry with that handle.</p>
      )}
    </main>
  );
}
