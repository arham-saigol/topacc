/**
 * Creem webhook signature verification (docs.creem.io/code/webhooks):
 * HMAC-SHA256 over the RAW request body, hex-encoded, sent in the
 * `creem-signature` header. Uses WebCrypto so it runs in Convex's
 * default (v8) runtime and in Node >= 18.
 */
export async function verifyCreemSignature(
  rawBody: string,
  secret: string,
  signatureHex: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(rawBody, secret);
  return timingSafeEqualHex(expected, signatureHex);
}

async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-independent constant-time comparison of two hex strings. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
