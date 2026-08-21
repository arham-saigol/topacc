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
  const [failed, setFailed] = useState(false);
  if (failed) {
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
      src={avatarUrl(handle)}
      alt={`@${handle} avatar`}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full bg-surface object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
