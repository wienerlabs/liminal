import { describe, expect, it } from "vitest";
import { aprToApy, batchFetch, chunks } from "./kliquidity-shim";

describe("kliquidity-shim.chunks", () => {
  it("splits evenly", () => {
    expect(chunks([1, 2, 3, 4], 2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
  it("handles remainder", () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns whole array when size >= length", () => {
    expect(chunks([1, 2], 10)).toEqual([[1, 2]]);
  });
  it("returns single-bucket copy when size <= 0", () => {
    expect(chunks([1, 2], 0)).toEqual([[1, 2]]);
    expect(chunks([1, 2], -1)).toEqual([[1, 2]]);
  });
});

describe("kliquidity-shim.batchFetch", () => {
  it("flattens async worker results across batches", async () => {
    const seen: number[][] = [];
    const result = await batchFetch(
      [1, 2, 3, 4, 5],
      async (batch) => {
        seen.push([...batch]);
        return batch.map((n) => n * 10);
      },
      2,
    );
    expect(result).toEqual([10, 20, 30, 40, 50]);
    expect(seen).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("tolerates a worker that returns sync array", async () => {
    const result = await batchFetch([1, 2], (batch) => batch, 5);
    expect(result).toEqual([1, 2]);
  });
});

describe("kliquidity-shim.aprToApy", () => {
  it("converts 0 to 0", () => {
    expect(aprToApy(0, 365)).toBe(0);
  });
  it("approximates continuous compounding for small APR / many periods", () => {
    // 1% APR daily compounding ≈ 1.005%
    const apy = aprToApy(0.01, 365);
    expect(apy).toBeGreaterThan(0.01);
    expect(apy).toBeLessThan(0.011);
  });
  it("returns 0 for invalid inputs", () => {
    expect(aprToApy(Number.NaN, 365)).toBe(0);
    expect(aprToApy(0.05, 0)).toBe(0);
    expect(aprToApy(0.05, -1)).toBe(0);
  });
});
