import { describe, expect, it } from "vitest";
import { canonicalizeHandle } from "./handle";

describe("canonicalizeHandle", () => {
  it.each([
    ["@elonmusk", "elonmusk"],
    [" Elonmusk ", "elonmusk"],
    ["ELONMUSK", "elonmusk"],
    ["elon_musk99", "elon_musk99"],
  ])("canonicalizes %j to %j", (input, expected) => {
    expect(canonicalizeHandle(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "@",
    "no spaces allowed",
    "hyphens-not-allowed",
    "dots.not.allowed",
    "this_handle_is_way_too_long", // 26 chars
    "unicode🚀",
  ])("rejects %j", (input) => {
    expect(canonicalizeHandle(input)).toBeNull();
  });

  it("accepts exactly 15 characters (X's handle limit)", () => {
    expect(canonicalizeHandle("abcdefghijklmno")).toBe("abcdefghijklmno");
    expect(canonicalizeHandle("abcdefghijklmnop")).toBeNull();
  });
});
