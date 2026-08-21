// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { timingSafeEqualHex, verifyCreemSignature } from "./webhook-signature";

const SECRET = "whsec_test_123";
const BODY = JSON.stringify({ id: "evt_1", eventType: "checkout.completed" });

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

describe("verifyCreemSignature", () => {
  it("accepts a valid signature from an independent HMAC implementation", async () => {
    const sig = sign(BODY, SECRET);
    expect(await verifyCreemSignature(BODY, SECRET, sig)).toBe(true);
  });

  it("rejects tampered payloads", async () => {
    const sig = sign(BODY, SECRET);
    expect(await verifyCreemSignature(`${BODY} `, SECRET, sig)).toBe(false);
  });

  it("rejects wrong secrets and garbage signatures", async () => {
    expect(await verifyCreemSignature(BODY, "other-secret", sign(BODY, SECRET))).toBe(false);
    expect(await verifyCreemSignature(BODY, SECRET, "not-hex-at-all!!")).toBe(false);
    expect(await verifyCreemSignature(BODY, SECRET, "")).toBe(false);
  });
});

describe("timingSafeEqualHex", () => {
  it("is length-independent and order-independent", () => {
    expect(timingSafeEqualHex("abc", "abc")).toBe(true);
    expect(timingSafeEqualHex("abcd", "abc")).toBe(false);
    expect(timingSafeEqualHex("abc", "abd")).toBe(false);
    expect(timingSafeEqualHex("", "")).toBe(true);
  });
});
