/**
 * LIMINAL — dcaScheduler tests
 *
 * Covers
 *   - createSchedule: shape, default firstFireAt, auto-derived label
 *   - getDueSchedule: respects nextFireAt, paused flag, returns null
 *     when nothing is due
 *   - markRan: bumps cyclesDone, advances nextFireAt by interval,
 *     deletes when totalCycles is reached
 *   - deferSchedule: pushes nextFireAt forward
 *   - pauseSchedule / cancelSchedule
 *   - subscribeSchedules: fires on writes, stops after unsubscribe
 *   - humanInterval: formats minutes / hours / days
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DcaPlan } from "./dcaScheduler";

const STORAGE_KEY = "liminal:dca:v1";

async function freshModule() {
  vi.resetModules();
  return import("./dcaScheduler");
}

const samplePlan: DcaPlan = {
  inputMint: "So11111111111111111111111111111111111111112",
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  inputSymbol: "SOL",
  outputSymbol: "USDC",
  amountPerCycle: 0.5,
  windowDurationMs: 60 * 60_000,
  sliceCount: 4,
  slippageBps: 50,
  preSignEnabled: true,
};

describe("dcaScheduler", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  describe("createSchedule", () => {
    it("returns a record with all required fields populated", async () => {
      const m = await freshModule();
      const rec = m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: 5 },
        plan: samplePlan,
      });
      expect(rec.id).toMatch(/^dca-/);
      expect(rec.cadence.intervalMs).toBe(60_000);
      expect(rec.cadence.totalCycles).toBe(5);
      expect(rec.cyclesDone).toBe(0);
      expect(rec.paused).toBe(false);
      expect(rec.lastRunAt).toBeNull();
    });

    it("auto-derives a label from the pair + cadence", async () => {
      const m = await freshModule();
      const rec = m.createSchedule({
        cadence: { intervalMs: 24 * 60 * 60_000, totalCycles: 7 },
        plan: samplePlan,
      });
      expect(rec.label).toMatch(/SOL → USDC/i);
      expect(rec.label).toMatch(/1 day/);
    });

    it("respects an explicit firstFireAt", async () => {
      const m = await freshModule();
      const future = new Date(Date.now() + 5 * 60_000);
      const rec = m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: 3 },
        plan: samplePlan,
        firstFireAt: future,
      });
      expect(new Date(rec.nextFireAt).getTime()).toBe(future.getTime());
    });
  });

  describe("getDueSchedule", () => {
    it("returns null when no schedules exist", async () => {
      const m = await freshModule();
      expect(m.getDueSchedule(new Date())).toBeNull();
    });

    it("returns the schedule whose nextFireAt has passed", async () => {
      const m = await freshModule();
      const past = new Date(Date.now() - 60_000);
      const rec = m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: 3 },
        plan: samplePlan,
        firstFireAt: past,
      });
      const due = m.getDueSchedule();
      expect(due?.id).toBe(rec.id);
    });

    it("does not return paused schedules even if due", async () => {
      const m = await freshModule();
      const past = new Date(Date.now() - 60_000);
      const rec = m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: 3 },
        plan: samplePlan,
        firstFireAt: past,
      });
      m.pauseSchedule(rec.id, true);
      expect(m.getDueSchedule()).toBeNull();
    });
  });

  describe("markRan", () => {
    it("bumps cyclesDone and pushes nextFireAt by the interval", async () => {
      const m = await freshModule();
      const past = new Date(Date.now() - 60_000);
      const rec = m.createSchedule({
        cadence: { intervalMs: 60 * 60_000, totalCycles: 3 },
        plan: samplePlan,
        firstFireAt: past,
      });
      const fireAt = new Date();
      m.markRan(rec.id, fireAt);

      const list = m.listSchedules();
      const updated = list.find((s) => s.id === rec.id);
      expect(updated?.cyclesDone).toBe(1);
      expect(updated?.lastRunAt).toBe(fireAt.toISOString());
      // Next fire should be 1h after `when`.
      expect(new Date(updated!.nextFireAt).getTime()).toBe(
        fireAt.getTime() + 60 * 60_000,
      );
    });

    it("deletes the schedule once cyclesDone reaches totalCycles", async () => {
      const m = await freshModule();
      const rec = m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: 2 },
        plan: samplePlan,
        firstFireAt: new Date(Date.now() - 1),
      });
      m.markRan(rec.id);
      expect(m.listSchedules().length).toBe(1);
      m.markRan(rec.id);
      expect(m.listSchedules().length).toBe(0);
    });

    it("never deletes when totalCycles is unlimited (-1)", async () => {
      const m = await freshModule();
      const rec = m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: -1 },
        plan: samplePlan,
      });
      for (let i = 0; i < 50; i++) m.markRan(rec.id);
      const updated = m.listSchedules().find((s) => s.id === rec.id);
      expect(updated?.cyclesDone).toBe(50);
    });
  });

  describe("deferSchedule", () => {
    it("pushes nextFireAt forward by the given delay", async () => {
      const m = await freshModule();
      const rec = m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: 3 },
        plan: samplePlan,
      });
      const before = Date.now();
      m.deferSchedule(rec.id, 5 * 60_000);
      const updated = m.listSchedules().find((s) => s.id === rec.id);
      const fireAt = new Date(updated!.nextFireAt).getTime();
      // At least 5min from now, allowing tiny clock drift.
      expect(fireAt).toBeGreaterThanOrEqual(before + 5 * 60_000 - 50);
    });
  });

  describe("subscribeSchedules", () => {
    it("fires on createSchedule + cancelSchedule + pauseSchedule + markRan", async () => {
      const m = await freshModule();
      const cb = vi.fn();
      m.subscribeSchedules(cb);

      const rec = m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: 3 },
        plan: samplePlan,
      });
      m.pauseSchedule(rec.id, true);
      m.markRan(rec.id);
      m.cancelSchedule(rec.id);

      expect(cb).toHaveBeenCalledTimes(4);
    });

    it("unsubscribe stops further callbacks", async () => {
      const m = await freshModule();
      const cb = vi.fn();
      const unsub = m.subscribeSchedules(cb);
      unsub();
      m.createSchedule({
        cadence: { intervalMs: 60_000, totalCycles: 3 },
        plan: samplePlan,
      });
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe("humanInterval", () => {
    it("formats minutes for sub-hour intervals", async () => {
      const m = await freshModule();
      expect(m.humanInterval(15 * 60_000)).toBe("15 min");
    });
    it("formats hours for sub-day intervals", async () => {
      const m = await freshModule();
      expect(m.humanInterval(1 * 60 * 60_000)).toBe("1 hour");
      expect(m.humanInterval(6 * 60 * 60_000)).toBe("6 hours");
    });
    it("formats days for >= 24h intervals", async () => {
      const m = await freshModule();
      expect(m.humanInterval(24 * 60 * 60_000)).toBe("1 day");
      expect(m.humanInterval(3 * 24 * 60 * 60_000)).toBe("3 days");
    });
  });

  describe("CADENCE_PRESETS", () => {
    it("includes the standard 5 presets", async () => {
      const m = await freshModule();
      expect(m.CADENCE_PRESETS.length).toBe(5);
      expect(m.CADENCE_PRESETS.map((c) => c.label)).toEqual([
        "Every 1h",
        "Every 6h",
        "Every 24h",
        "Every 3 days",
        "Every 7 days",
      ]);
    });
  });
});
