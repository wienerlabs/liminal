import { afterEach, describe, expect, it, vi } from "vitest";
import { ExecutionStatus } from "../state/executionMachine";
import {
  CURRENT_TAB_ID,
  broadcast,
  getOtherTabsInFlight,
  subscribeOtherTabsInFlight,
} from "./multiTab";

/**
 * Multi-tab service tests. Verifies:
 *   - Stable per-tab ID
 *   - subscribeOtherTabsInFlight fires once on subscribe with current state
 *   - getOtherTabsInFlight returns false initially (no other tabs seen)
 *   - broadcast doesn't throw when BroadcastChannel is unavailable
 *
 * Cross-tab BroadcastChannel pub/sub is integration-tested in browser
 * (happy-dom doesn't faithfully simulate cross-tab message routing).
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CURRENT_TAB_ID", () => {
  it("is a stable, non-empty string starting with 'tab-'", () => {
    expect(typeof CURRENT_TAB_ID).toBe("string");
    expect(CURRENT_TAB_ID.length).toBeGreaterThan(4);
    expect(CURRENT_TAB_ID.startsWith("tab-")).toBe(true);
  });

  it("is identical across imports (singleton per module load)", async () => {
    const { CURRENT_TAB_ID: again } = await import("./multiTab");
    expect(again).toBe(CURRENT_TAB_ID);
  });
});

describe("subscribeOtherTabsInFlight", () => {
  it("fires the callback once on subscribe with the current state", () => {
    const cb = vi.fn();
    const unsub = subscribeOtherTabsInFlight(cb);
    // Sync — fires immediately with the current value (false in a
    // fresh test context where no other tab has broadcast).
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(false);
    unsub();
  });

  it("returns an unsubscribe function that detaches the listener", () => {
    const cb = vi.fn();
    const unsub = subscribeOtherTabsInFlight(cb);
    const initialCalls = cb.mock.calls.length;
    unsub();
    // After unsubscribe, even if we trigger an internal notify
    // (broadcast is no-op without BroadcastChannel), the cb count
    // shouldn't increase.
    broadcast(ExecutionStatus.ACTIVE);
    expect(cb.mock.calls.length).toBe(initialCalls);
  });
});

describe("getOtherTabsInFlight", () => {
  it("returns false when no other tabs have broadcast", () => {
    expect(getOtherTabsInFlight()).toBe(false);
  });
});

describe("broadcast", () => {
  it("does not throw when called repeatedly", () => {
    expect(() => {
      broadcast(ExecutionStatus.IDLE);
      broadcast(ExecutionStatus.PREPARING);
      broadcast(ExecutionStatus.DEPOSITING);
      broadcast(ExecutionStatus.ACTIVE);
      broadcast(ExecutionStatus.DONE);
    }).not.toThrow();
  });
});
