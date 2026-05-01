/**
 * LIMINAL — riskAdvisor tests
 *
 * Each rule is exercised via generateTips() with synthetic history.
 * The rule registry is private so we drive it through the public API
 * — that's also how the UI consumes it, so the tests double as
 * integration coverage.
 */

import { describe, expect, it } from "vitest";
import { generateTips, type AdvisorContext } from "./riskAdvisor";
import type { HistoricalExecution } from "./analyticsStore";

function buildExecution(opts: {
  completed: number;
  skipped: number;
  durationMs?: number;
  yieldUsd?: number;
  bps?: number;
  capture?: number;
  ageMs?: number;
}): HistoricalExecution {
  const dur = opts.durationMs ?? 30 * 60_000;
  const yieldUsd = opts.yieldUsd ?? 0;
  const bps = opts.bps ?? 5;
  const cap = opts.capture ?? 0;
  const age = opts.ageMs ?? 0;
  return {
    id: `t-${Math.random()}`,
    inputMint: "So111",
    outputMint: "EPjFW",
    inputSymbol: "SOL",
    outputSymbol: "USDC",
    summary: {
      totalInputAmount: 1,
      totalOutputAmount: 100,
      averageExecutionPrice: 100,
      baselinePrice: 99,
      totalPriceImprovementBps: bps,
      totalPriceImprovementUsd: cap,
      totalKaminoYieldUsd: yieldUsd,
      totalValueCaptureUsd: cap + yieldUsd,
      executionDurationMs: dur,
      completedSlices: opts.completed,
      skippedSlices: opts.skipped,
      startedAt: new Date(Date.now() - age - dur),
      completedAt: new Date(Date.now() - age),
    },
    slices: [],
    createdAt: new Date(Date.now() - age),
  };
}

describe("riskAdvisor.generateTips", () => {
  it("returns nothing when history is empty", () => {
    const ctx: AdvisorContext = { history: [] };
    expect(generateTips(ctx)).toEqual([]);
  });

  it("returns nothing when history has only one execution (below MIN_SAMPLE)", () => {
    const ctx: AdvisorContext = {
      history: [buildExecution({ completed: 4, skipped: 0 })],
    };
    expect(generateTips(ctx)).toEqual([]);
  });

  describe("slippage-too-low rule", () => {
    it("fires a warn tip when > 30% of slices were deferred", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 4, skipped: 4 }),
          buildExecution({ completed: 3, skipped: 3 }),
        ],
        currentSlippageBps: 50,
      };
      const tips = generateTips(ctx);
      const tip = tips.find((t) => t.id === "slippage-too-low");
      expect(tip).toBeDefined();
      expect(tip?.severity).toBe("warn");
      expect(tip?.cta?.key).toMatch(/^slippage:/);
      // Suggested = 50 × 1.5 = 75 capped at 300
      expect(tip?.cta?.key).toBe("slippage:75");
    });

    it("does not fire when defer rate is below 30%", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 10, skipped: 1 }),
          buildExecution({ completed: 10, skipped: 1 }),
        ],
        currentSlippageBps: 50,
      };
      const tips = generateTips(ctx);
      expect(tips.find((t) => t.id === "slippage-too-low")).toBeUndefined();
    });

    it("uses default 75 bps suggestion when currentSlippageBps is missing", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 4, skipped: 4 }),
          buildExecution({ completed: 4, skipped: 4 }),
        ],
      };
      const tip = generateTips(ctx).find((t) => t.id === "slippage-too-low");
      expect(tip?.cta?.key).toBe("slippage:75");
    });
  });

  describe("slippage-too-high rule", () => {
    it("fires an info tip when defer rate is < 5% AND current setting > 50bps", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 6, skipped: 0 }),
          buildExecution({ completed: 4, skipped: 0 }),
        ],
        currentSlippageBps: 100,
      };
      const tip = generateTips(ctx).find((t) => t.id === "slippage-too-high");
      expect(tip).toBeDefined();
      expect(tip?.severity).toBe("info");
      // Suggested = 100 × 0.7 = 70
      expect(tip?.cta?.key).toBe("slippage:70");
    });

    it("does not fire when current slippage is already at/below 50bps", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 6, skipped: 0 }),
          buildExecution({ completed: 4, skipped: 0 }),
        ],
        currentSlippageBps: 50,
      };
      expect(
        generateTips(ctx).find((t) => t.id === "slippage-too-high"),
      ).toBeUndefined();
    });

    it("does not fire when sample is too small (< 6 slices total)", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 2, skipped: 0 }),
          buildExecution({ completed: 2, skipped: 0 }),
        ],
        currentSlippageBps: 100,
      };
      expect(
        generateTips(ctx).find((t) => t.id === "slippage-too-high"),
      ).toBeUndefined();
    });
  });

  describe("window-too-narrow rule", () => {
    it("fires a warn tip when avg slice interval is < 5 minutes", () => {
      // 2 slices over 4 minutes → 2 min/slice.
      const ctx: AdvisorContext = {
        history: [
          buildExecution({
            completed: 2,
            skipped: 0,
            durationMs: 4 * 60_000,
          }),
          buildExecution({
            completed: 2,
            skipped: 0,
            durationMs: 4 * 60_000,
          }),
        ],
      };
      const tip = generateTips(ctx).find((t) => t.id === "window-too-narrow");
      expect(tip).toBeDefined();
      expect(tip?.severity).toBe("warn");
    });

    it("does not fire when slice interval is comfortable", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({
            completed: 2,
            skipped: 0,
            durationMs: 30 * 60_000,
          }),
          buildExecution({
            completed: 2,
            skipped: 0,
            durationMs: 30 * 60_000,
          }),
        ],
      };
      expect(
        generateTips(ctx).find((t) => t.id === "window-too-narrow"),
      ).toBeUndefined();
    });
  });

  describe("healthy-vault rule", () => {
    it("fires an info tip when avg Kamino yield > $0.50", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 4, skipped: 0, yieldUsd: 1.2 }),
          buildExecution({ completed: 4, skipped: 0, yieldUsd: 0.8 }),
        ],
      };
      const tip = generateTips(ctx).find((t) => t.id === "healthy-vault");
      expect(tip).toBeDefined();
      expect(tip?.severity).toBe("info");
    });

    it("does not fire when yield is trivial", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 4, skipped: 0, yieldUsd: 0.01 }),
          buildExecution({ completed: 4, skipped: 0, yieldUsd: 0.05 }),
        ],
      };
      expect(
        generateTips(ctx).find((t) => t.id === "healthy-vault"),
      ).toBeUndefined();
    });
  });

  describe("skipped-spike rule", () => {
    it("fires a danger tip when last run had > 50% skipped", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 1, skipped: 4 }),
          buildExecution({ completed: 4, skipped: 0 }),
        ],
      };
      const tip = generateTips(ctx).find((t) => t.id === "skipped-spike");
      expect(tip).toBeDefined();
      expect(tip?.severity).toBe("danger");
    });

    it("does not fire when total slices is below 4", () => {
      const ctx: AdvisorContext = {
        history: [
          buildExecution({ completed: 1, skipped: 1 }),
          buildExecution({ completed: 4, skipped: 0 }),
        ],
      };
      expect(
        generateTips(ctx).find((t) => t.id === "skipped-spike"),
      ).toBeUndefined();
    });
  });
});
