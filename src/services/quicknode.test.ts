import { describe, expect, it } from "vitest";
import { isRateLimitError } from "./quicknode";

/**
 * isRateLimitError classifies RPC / aggregator failures that warrant
 * exponential backoff. False positives here would retry on errors that
 * are actually user-action-required (e.g. insufficient funds), so these
 * boundaries matter.
 */
describe("isRateLimitError", () => {
  it.each([
    ["429 Too Many Requests", true],
    ["Error: rate limit exceeded", true],
    ["please slow down", true],
    ["Your rate limit has been exceeded quota", true],
    ["Transaction too large", false],
    ["Insufficient funds", false],
    ["blockhash expired", false],
    ["User rejected the request", false],
    ["", false],
  ])("%s → %s", (msg, expected) => {
    expect(isRateLimitError(new Error(msg))).toBe(expected);
  });

  it("returns false for non-error inputs", () => {
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});
