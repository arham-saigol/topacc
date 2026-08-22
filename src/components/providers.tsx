"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

function getConvexUrl(): string {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is not set");
  return url;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConvexProvider client={new ConvexReactClient(getConvexUrl())}>
      {children}
    </ConvexProvider>
  );
}

/** https://<name>.convex.cloud -> https://<name>.convex.site (httpActions). */
export function convexSiteUrl(): string {
  return getConvexUrl().replace(/\.convex\.cloud$/, ".convex.site");
}
