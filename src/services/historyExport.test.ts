/**
 * LIMINAL — historyExport tests
 *
 * Pure-function tests for the CSV serialiser. We don't exercise
 * triggerDownload here — that touches DOM + URL.createObjectURL which
 * happy-dom's polyfill is fine but the assertion surface is shallow
 * (the browser does the real work). The string assembly + escape
 * logic is what's worth pinning.
 */

import { describe, expect, it } from "vitest";
import {
  defaultFilename,
  executionsToCsv,
  slicesToCsv,
} from "./historyExport";
import type {
  HistoricalExecution,
  SliceAnalytics,
} from "./analyticsStore";

function buildExecution(
  id: string,
  overrides?: Partial<HistoricalExecution["summary"]>,
): HistoricalExecution {
  const summary: HistoricalExecution["summary"] = {
    totalInputAmount: 1.5,
    totalOutputAmount: 165.42,
    averageExecutionPrice: 110.28,
    baselinePrice: 109.5,
    totalPriceImprovementBps: 7.1,
    totalPriceImprovementUsd: 1.18,
    totalKaminoYieldUsd: 0.42,
    totalValueCaptureUsd: 1.6,
    executionDurationMs: 60 * 60_000,
    completedSlices: 4,
    skippedSlices: 0,
    startedAt: new Date("2026-01-15T10:00:00Z"),
    completedAt: new Date("2026-01-15T11:00:00Z"),
    ...overrides,
  };
  return {
    id,
    inputMint: "So11111111111111111111111111111111111111112",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    inputSymbol: "SOL",
    outputSymbol: "USDC",
    summary,
    slices: [],
    createdAt: new Date("2026-01-15T11:00:00Z"),
  };
}

function buildSlice(idx: number): SliceAnalytics {
  return {
    sliceIndex: idx,
    executedAt: new Date("2026-01-15T10:30:00Z"),
    inputAmount: 0.375,
    outputAmount: 41.4,
    executionPrice: 110.4,
    marketPrice: 109.8,
    priceImprovementBps: 5.5,
    priceImprovementUsd: 0.29,
    kaminoDurationMs: 5 * 60_000,
    kaminoYieldUsd: 0.105,
    signature: "5xy2..." + idx,
  };
}

describe("executionsToCsv", () => {
  it("emits the header row + one row per execution", () => {
    const csv = executionsToCsv([buildExecution("a"), buildExecution("b")]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(3); // header + 2
    expect(lines[0]).toMatch(/^id,/);
    expect(lines[0]).toMatch(/vs_jupiter_usd/);
    expect(lines[0]).toMatch(/vs_jupiter_bps/);
    expect(lines[0]).toMatch(/kamino_yield_usd/);
  });

  it("serialises numeric fields without quoting", () => {
    const csv = executionsToCsv([buildExecution("a")]);
    const data = csv.split("\n")[1];
    expect(data).toContain(",1.5,"); // totalInputAmount
    expect(data).toContain(",165.42,"); // totalOutputAmount
    expect(data).toContain(",1.18,"); // vs_jupiter_usd
  });

  it("ISO-formats timestamps", () => {
    const csv = executionsToCsv([buildExecution("a")]);
    expect(csv).toContain("2026-01-15T10:00:00.000Z");
    expect(csv).toContain("2026-01-15T11:00:00.000Z");
  });

  it("handles empty input gracefully", () => {
    const csv = executionsToCsv([]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(1); // header only
    expect(lines[0]).toMatch(/^id,/);
  });

  it("escapes values containing commas, quotes, newlines per RFC-4180", () => {
    const exec = buildExecution("a");
    // Symbols normally don't contain commas but let's make sure the
    // escape logic kicks in if one ever does.
    exec.inputSymbol = "weird,name";
    exec.outputSymbol = 'with"quote';
    const csv = executionsToCsv([exec]);
    expect(csv).toContain('"weird,name"');
    expect(csv).toContain('"with""quote"');
  });
});

describe("slicesToCsv", () => {
  it("emits one row per slice across all executions", () => {
    const e1 = buildExecution("a");
    e1.slices = [buildSlice(0), buildSlice(1)];
    const e2 = buildExecution("b");
    e2.slices = [buildSlice(0)];

    const csv = slicesToCsv([e1, e2]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(4); // header + 3 rows
    expect(lines[0]).toMatch(/^execution_id,/);
    expect(lines[0]).toMatch(/signature/);
  });

  it("includes kamino_duration_ms + kamino_yield_usd columns", () => {
    const e = buildExecution("a");
    e.slices = [buildSlice(0)];
    const csv = slicesToCsv([e]);
    expect(csv).toContain("kamino_duration_ms");
    expect(csv).toContain("kamino_yield_usd");
    // 5 minutes = 300000ms
    expect(csv).toContain(",300000,");
  });

  it("preserves transaction signatures verbatim", () => {
    const e = buildExecution("a");
    e.slices = [buildSlice(0)];
    const csv = slicesToCsv([e]);
    expect(csv).toContain("5xy2...0");
  });
});

describe("defaultFilename", () => {
  it("formats as <prefix>-YYYYMMDD.csv", () => {
    const name = defaultFilename("liminal-test");
    expect(name).toMatch(/^liminal-test-\d{8}\.csv$/);
  });
});
