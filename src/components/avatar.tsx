"use client";

import { useState } from "react";
import { avatarUrl } from "@/lib/handle";

/**
 * X avatar via unavatar.io with a deterministic letter-avatar fallback
 * (rendered when unavatar has nothing). Never calls the official X API.
 */
export function Avatar({
  handle,
  size = 40,
  className = "",
}: {
  handle: string;
  size?: number;
  className?: string;
}) {
  // Track WHICH handle failed so a new handle gets a fresh request.
  const [failedHandle, setFailedHandle] = useState<string | null>(null);
  if (failedHandle === handle) {
    return (
      <span
        aria-hidden
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-600 font-bold text-white select-none ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.45 }}
      >
        {handle[0]?.toUpperCase() ?? "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={handle}
      src={avatarUrl(handle)}
      alt={`@${handle} avatar`}
      width={size}
      height={size}
      onError={() => setFailedHandle(handle)}
      className={`shrink-0 rounded-full bg-surface object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
