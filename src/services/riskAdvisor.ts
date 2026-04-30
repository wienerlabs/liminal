/**
 * LIMINAL — riskAdvisor
 *
 * Pure-function tip generator that scans the user's local execution
 * history (analyticsStore) and returns a small list of actionable
 * suggestions. The goal is to nudge the user toward better settings
 * without requiring them to read trading literature — "your last 4
 * slices hit slippage, raise the threshold" beats "set slippage
 * appropriately."
 *
 * Output is rendered by `RiskAdvisor.tsx`. Pure functions kept
 * separate so the rules can be unit-tested without DOM.
 *
 * Tip rules (currently five; new ones drop in by appending to RULES)
 *   1. Slippage trip-rate — % of recent slices that hit the threshold
 *      and were deferred. > 30% → suggest raising slippage by ~50%.
 *   2. Slippage trip-rate (low) — < 5% across a meaningful sample
 *      and current setting > 50 bps → suggest lowering for tighter fills.
 *   3. Window vs slice count — average slice interval < 5 min on the
 *      last few runs → likely under-pacing. Suggest fewer slices or
 *      wider window.
 *   4. Yield-rate observed vs setting — Kamino vault APY in last
 *      runs averaged > 6% → call out the user has been parking in
 *      a healthy vault, no change needed (positive reinforcement).
 *   5. Skipped-slice spike — most recent run had > 50% skipped
 *      slices → flag a market-condition warning and suggest auto-
 *      pause if a similar profile reappears.
 *
 * Severity levels: "info" (positive / FYI), "warn" (action recommended),
 * "danger" (strong recommendation; UI may use bolder treatment).
 */

import type { HistoricalExecution } from "./analyticsStore";

export type AdvisorTip = {
  id: string;
  severity: "info" | "warn" | "danger";
  title: string;
  body: string;
  /** Optional concrete suggestion the consumer can apply with one
   * click — e.g. "Set slippage to 75 bps". The consumer wires the
   * actual mutation; this just supplies the label + key. */
  cta?: { label: string; key: string };
};

export type AdvisorContext = {
  /** Most-recent N executions, freshest first. */
  history: HistoricalExecution[];
  /** Current slippage threshold (bps) the user has on the form. */
  currentSlippageBps?: number;
};

const MIN_SAMPLE = 2; // need at least this many runs to form an opinion

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function totalCompleted(runs: HistoricalExecution[]): number {
  return runs.reduce((s, r) => s + r.summary.completedSlices, 0);
}
function totalSkipped(runs: HistoricalExecution[]): number {
  return runs.reduce((s, r) => s + r.summary.skippedSlices, 0);
}
function avgKaminoYieldUsd(runs: HistoricalExecution[]): number {
  if (runs.length === 0) return 0;
  return (
    runs.reduce((s, r) => s + r.summary.totalKaminoYieldUsd, 0) / runs.length
  );
}

// ---------------------------------------------------------------------------
// Rule registry
// ---------------------------------------------------------------------------

type Rule = (ctx: AdvisorContext) => AdvisorTip | null;

const ruleSlippageTooLow: Rule = (ctx) => {
  const recent = ctx.history.slice(0, 5);
  if (recent.length < MIN_SAMPLE) return null;

  const completed = totalCompleted(recent);
  const skipped = totalSkipped(recent);
  if (completed + skipped === 0) return null;
  const tripRate = skipped / (completed + skipped);

  if (tripRate < 0.3) return null;
  const suggested = ctx.currentSlippageBps
    ? Math.min(300, Math.round(ctx.currentSlippageBps * 1.5))
    : 75;

  return {
    id: "slippage-too-low",
    severity: "warn",
    title: "Slices keep hitting your slippage limit",
    body: `${Math.round(tripRate * 100)}% of your recent slices were deferred at the threshold. Raising slippage to ~${suggested} bps would have filled them on the first try without giving up MEV protection.`,
    cta: { label: `Set slippage ${suggested} bps`, key: `slippage:${suggested}` },
  };
};

const ruleSlippageTooHigh: Rule = (ctx) => {
  const recent = ctx.history.slice(0, 5);
  if (recent.length < MIN_SAMPLE) return null;
  if (!ctx.currentSlippageBps || ctx.currentSlippageBps <= 50) return null;

  const completed = totalCompleted(recent);
  const skipped = totalSkipped(recent);
  if (completed + skipped < 6) return null;
  const tripRate = skipped / (completed + skipped);

  if (tripRate > 0.05) return null;

  const suggested = Math.max(20, Math.round(ctx.currentSlippageBps * 0.7));
  return {
    id: "slippage-too-high",
    severity: "info",
    title: "You've been leaving spread on the table",
    body: `Your last ${completed} slices fit comfortably under your slippage budget. Tightening to ~${suggested} bps would push DFlow toward better-priced fills without raising your defer rate meaningfully.`,
    cta: { label: `Set slippage ${suggested} bps`, key: `slippage:${suggested}` },
  };
};

const ruleWindowTooNarrow: Rule = (ctx) => {
  const recent = ctx.history.slice(0, 4);
  if (recent.length < MIN_SAMPLE) return null;

  // Average minutes per slice across recent runs.
  const sumMinPerSlice = recent.reduce((s, r) => {
    const mins = r.summary.executionDurationMs / 60000;
    const denom = Math.max(1, r.summary.completedSlices + r.summary.skippedSlices);
    return s + mins / denom;
  }, 0);
  const avgMinPerSlice = sumMinPerSlice / recent.length;

  if (avgMinPerSlice >= 5) return null;
  return {
    id: "window-too-narrow",
    severity: "warn",
    title: "Slice interval is shorter than 5 minutes",
    body: `Recent runs averaged ${avgMinPerSlice.toFixed(1)} minutes per slice. Tight intervals leave less room for the Quicknode price monitor to find a good moment — widening the window or cutting slice count usually improves fill quality.`,
  };
};

const ruleHealthyVault: Rule = (ctx) => {
  const recent = ctx.history.slice(0, 3);
  if (recent.length < MIN_SAMPLE) return null;

  // Heuristic: > $0.5 average yield per run + non-trivial principal
  // implies user is hitting a healthy APY. We don't have APY directly
  // saved, so we use the dollar-yield as a proxy.
  const avgYield = avgKaminoYieldUsd(recent);
  if (avgYield < 0.5) return null;

  return {
    id: "healthy-vault",
    severity: "info",
    title: "You're parking in a healthy vault",
    body: `Last ${recent.length} runs averaged $${avgYield.toFixed(2)} of Kamino yield while waiting for fills. The auto-vault selector is doing its job — no change needed.`,
  };
};

const ruleSkippedSpike: Rule = (ctx) => {
  const last = ctx.history[0];
  if (!last) return null;
  const total = last.summary.completedSlices + last.summary.skippedSlices;
  if (total < 4) return null;
  const skipRate = last.summary.skippedSlices / total;
  if (skipRate <= 0.5) return null;

  return {
    id: "skipped-spike",
    severity: "danger",
    title: "Last run hit a wall of skipped slices",
    body: `${last.summary.skippedSlices} of ${total} slices in your most recent execution were deferred at the slippage limit. That usually means a volatile market moment — consider waiting it out, raising slippage, or splitting the trade across two runs.`,
  };
};

const RULES: Rule[] = [
  ruleSlippageTooLow,
  ruleSlippageTooHigh,
  ruleWindowTooNarrow,
  ruleHealthyVault,
  ruleSkippedSpike,
];

export function generateTips(ctx: AdvisorContext): AdvisorTip[] {
  const tips: AdvisorTip[] = [];
  for (const rule of RULES) {
    const t = rule(ctx);
    if (t) tips.push(t);
  }
  return tips;
}
