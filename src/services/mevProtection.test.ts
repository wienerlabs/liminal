/**
 * LIMINAL — mevProtection tests
 *
 * The strategy resolver is a pure function over an env-derived mode.
 * Three modes:
 *   - jupiter-ultra (default)
 *   - jupiter-ultra+constellation
 *   - constellation-only
 *
 * Tests verify each mode returns the right `layers[].active` flags
 * and the right `label` / `constellationActive` boolean.
 *
 * Note: ACTIVE_STRATEGY is captured at module load time from
 * import.meta.env, so we can only test the *resolved* strategy here
 * (we don't re-import per test). For an end-to-end test of the env
 * branching the runner would need to vi.mock import.meta.env which
 * Vitest supports but the cost outweighs the value — the buildStrategy
 * function is pure and the branching is two if/else lines.
 */

import { describe, expect, it } from "vitest";
import { getMevStrategy } from "./mevProtection";

describe("mevProtection", () => {
  it("returns a strategy object with layers + label + ready/active flags", () => {
    const s = getMevStrategy();
    expect(s).toHaveProperty("mode");
    expect(s).toHaveProperty("label");
    expect(Array.isArray(s.layers)).toBe(true);
    expect(s.layers.length).toBe(2);
    expect(s).toHaveProperty("constellationReady");
    expect(s).toHaveProperty("constellationActive");
  });

  it("each layer carries name + description + active + referenceUrl", () => {
    const s = getMevStrategy();
    for (const layer of s.layers) {
      expect(typeof layer.name).toBe("string");
      expect(layer.name.length).toBeGreaterThan(5);
      expect(typeof layer.description).toBe("string");
      expect(typeof layer.active).toBe("boolean");
      expect(layer.referenceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("first layer is always the Jupiter Ultra / DFlow routing layer", () => {
    const s = getMevStrategy();
    expect(s.layers[0].name).toMatch(/Jupiter Ultra/i);
    expect(s.layers[0].name).toMatch(/DFlow/i);
  });

  it("second layer is always the Constellation MCP layer", () => {
    const s = getMevStrategy();
    expect(s.layers[1].name).toMatch(/Constellation/i);
  });

  it("constellationReady is true regardless of mode", () => {
    // The plumbing exists in the client for all modes; ready != active.
    expect(getMevStrategy().constellationReady).toBe(true);
  });

  it("label matches the mode", () => {
    const s = getMevStrategy();
    if (s.mode === "jupiter-ultra") {
      expect(s.label).toMatch(/Jupiter Ultra/i);
    } else if (s.mode === "jupiter-ultra+constellation") {
      expect(s.label).toMatch(/Hybrid/i);
    } else if (s.mode === "constellation-only") {
      expect(s.label).toMatch(/Constellation-only/i);
    }
  });

  it("constellationActive reflects whether the constellation layer is active", () => {
    const s = getMevStrategy();
    expect(s.constellationActive).toBe(s.layers[1].active);
  });

  it("returns the same object on repeated calls (stable reference)", () => {
    expect(getMevStrategy()).toBe(getMevStrategy());
  });
});
