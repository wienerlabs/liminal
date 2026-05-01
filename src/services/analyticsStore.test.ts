/**
 * LIMINAL — analyticsStore tests
 *
 * Covers the localStorage-backed history layer:
 *   - saveExecution / getHistory: persistence + ordering (newest first)
 *   - deleteExecution / clearHistory: cleanup
 *   - persistence round-trip across module reloads
 *   - graceful handling of corrupt localStorage payloads
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoricalExecution } from "./analyticsStore";

async function freshModule() {
  vi.resetModules();
  return import("./analyticsStore");
}

function buildEntry(
  id: string,
  createdMs: number,
): HistoricalExecution {
  return {
    id,
    inputMint: "So11",
    outputMint: "EPjFW",
    inputSymbol: "SOL",
    outputSymbol: "USDC",
    summary: {
      totalInputAmount: 1,
      totalOutputAmount: 100,
      averageExecutionPrice: 100,
      baselinePrice: 99,
      totalPriceImprovementBps: 5,
      totalPriceImprovementUsd: 0.5,
      totalKaminoYieldUsd: 0.1,
      totalValueCaptureUsd: 0.6,
      executionDurationMs: 60_000,
      completedSlices: 4,
      skippedSlices: 0,
      startedAt: new Date(createdMs - 60_000),
      completedAt: new Date(createdMs),
    },
    slices: [],
    createdAt: new Date(createdMs),
  };
}

describe("analyticsStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("saveExecution persists a record and getHistory returns it", async () => {
    const m = await freshModule();
    m.saveExecution(buildEntry("exec-1", Date.now()));
    const list = m.getHistory();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("exec-1");
  });

  it("getHistory returns newest-first by createdAt", async () => {
    const m = await freshModule();
    const t = Date.now();
    m.saveExecution(buildEntry("old", t - 60_000));
    m.saveExecution(buildEntry("middle", t - 30_000));
    m.saveExecution(buildEntry("new", t));
    const list = m.getHistory();
    expect(list.map((e) => e.id)).toEqual(["new", "middle", "old"]);
  });

  it("saveExecution prepends — newest entry first, no automatic dedup by id", async () => {
    // Implementation note: store is append-prepend with FIFO cap of 50.
    // Re-saving the same id is allowed (machine never does it in
    // practice, but the store doesn't enforce uniqueness).
    const m = await freshModule();
    const t = Date.now();
    m.saveExecution(buildEntry("exec-1", t));
    m.saveExecution(buildEntry("exec-1", t + 1000));
    const list = m.getHistory();
    expect(list.length).toBe(2);
    // The newer one is first.
    expect(list[0].createdAt.getTime()).toBe(t + 1000);
  });

  it("caps history at 50 entries (FIFO)", async () => {
    const m = await freshModule();
    const base = Date.now();
    for (let i = 0; i < 60; i++) {
      m.saveExecution(buildEntry(`e-${i}`, base + i));
    }
    expect(m.getHistory().length).toBe(50);
    // Newest 50 kept; oldest 10 dropped.
    const ids = m.getHistory().map((e) => e.id);
    expect(ids[0]).toBe("e-59");
    expect(ids).not.toContain("e-0");
    expect(ids).not.toContain("e-9");
  });

  it("deleteExecution removes a record by id", async () => {
    const m = await freshModule();
    m.saveExecution(buildEntry("a", Date.now()));
    m.saveExecution(buildEntry("b", Date.now() + 1));
    m.deleteExecution("a");
    expect(m.getHistory().map((e) => e.id)).toEqual(["b"]);
  });

  it("deleteExecution is a no-op for unknown ids", async () => {
    const m = await freshModule();
    m.saveExecution(buildEntry("a", Date.now()));
    expect(() => m.deleteExecution("nope")).not.toThrow();
    expect(m.getHistory().length).toBe(1);
  });

  it("clearHistory wipes everything", async () => {
    const m = await freshModule();
    m.saveExecution(buildEntry("a", Date.now()));
    m.saveExecution(buildEntry("b", Date.now() + 1));
    m.clearHistory();
    expect(m.getHistory()).toEqual([]);
  });

  it("persists across module reloads", async () => {
    const m1 = await freshModule();
    m1.saveExecution(buildEntry("a", Date.now()));
    const m2 = await freshModule();
    expect(m2.getHistory().length).toBe(1);
  });

  it("Date fields round-trip as Date instances", async () => {
    const t = Date.now();
    const m1 = await freshModule();
    m1.saveExecution(buildEntry("a", t));
    const m2 = await freshModule();
    const fetched = m2.getHistory()[0];
    expect(fetched.createdAt).toBeInstanceOf(Date);
    expect(fetched.summary.startedAt).toBeInstanceOf(Date);
    expect(fetched.summary.completedAt).toBeInstanceOf(Date);
    expect(fetched.createdAt.getTime()).toBe(t);
  });

  it("survives corrupt JSON without throwing on module load", async () => {
    localStorage.setItem("liminal:analytics:history", "not valid json{{{");
    // Should not throw.
    const m = await freshModule();
    expect(m.getHistory()).toEqual([]);
  });
});
