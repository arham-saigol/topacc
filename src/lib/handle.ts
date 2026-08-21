const HANDLE_RE = /^[a-z0-9_]{1,15}$/;

/**
 * Canonical form used for every lookup and dedup: strip leading @,
 * trim, lowercase; must match X's handle rules. Returns null if invalid.
 */
export function canonicalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@+/, "").toLowerCase();
  return HANDLE_RE.test(handle) ? handle : null;
}

/** The profile URL shown/linked everywhere. */
export function xUrl(handle: string): string {
  return `https://x.com/${handle}`;
}

/** Free avatar proxy; browsers render it directly with a letter fallback. */
export function avatarUrl(handle: string): string {
  return `https://unavatar.io/x/${handle}`;
}
