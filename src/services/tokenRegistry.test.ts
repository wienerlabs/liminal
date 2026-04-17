import { describe, expect, it } from "vitest";
import { symbolFor, lookupToken } from "./tokenRegistry";

describe("tokenRegistry.symbolFor", () => {
  it("returns full mint when under 10 chars (boundary)", () => {
    expect(symbolFor("short")).toBe("short");
  });

  it("returns shortened Ab12…Xy89 fallback for unknown mints", () => {
    const mint = "So11111111111111111111111111111111111111112";
    const out = symbolFor(mint);
    expect(out).toMatch(/^[A-Za-z0-9]{4}…[A-Za-z0-9]{4}$/);
    expect(out.startsWith(mint.slice(0, 4))).toBe(true);
    expect(out.endsWith(mint.slice(-4))).toBe(true);
  });

  it("lookupToken returns null for mints that have not been requested", () => {
    expect(lookupToken("NonExistentMint1111111111111111111111111111")).toBe(
      null,
    );
  });

  it("symbolFor can return the full mint when fallbackShort is false", () => {
    const mint = "So11111111111111111111111111111111111111112";
    expect(symbolFor(mint, false)).toBe(mint);
  });
});
