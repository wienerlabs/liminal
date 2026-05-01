/**
 * LIMINAL — dcaScheduler
 *
 * Lightweight, local-first DCA (dollar-cost averaging) scheduler. The
 * user pre-configures a TWAP plan once and asks the scheduler to
 * re-run it every N hours/days for M cycles. Each cycle is just a
 * normal execution: same input mint, same per-cycle amount, same
 * window, same slice count, same slippage threshold.
 *
 * Why this is local-first: the wallet still has to sign each cycle,
 * so a server-side cron wouldn't help unless we moved to a custodial
 * model (out of scope, see CLAUDE.md). Instead we keep the schedule
 * in localStorage, run it from a `setInterval` while a tab is open,
 * and surface the next-fire time prominently so the user knows what
 * to expect. Closed tab = paused — explicit and honest.
 *
 * Data model:
 *   DcaSchedule {
 *     id, label, cadence: { intervalMs, totalCycles }, plan, cyclesDone,
 *     createdAt, lastRunAt, nextFireAt, paused
 *   }
 *
 * Lifecycle:
 *   - createSchedule()  → adds new schedule + computes nextFireAt
 *   - cancelSchedule()  → removes by id
 *   - pauseSchedule()   → toggles paused
 *   - getDueSchedule()  → returns the first schedule whose
 *                         nextFireAt <= now AND not paused
 *   - markRan()         → bumps cyclesDone, recomputes nextFireAt;
 *                         deletes when cyclesDone >= totalCycles
 *
 * Subscribe pattern matches profileStore / analyticsStore.
 */

import type { ExecutionConfig } from "../state/executionMachine";

const STORAGE_KEY = "liminal:dca:v1";

export type DcaPlan = {
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  /** Per-cycle input amount (token units). */
  amountPerCycle: number;
  windowDurationMs: number;
  sliceCount: number;
  slippageBps: number;
  preSignEnabled: boolean;
  /** kaminoVaultAddress is resolved at execute-time from
   * selectOptimalVault — the schedule doesn't pin a vault because
   * the highest-APY option may change between cycles. */
};

export type DcaSchedule = {
  id: string;
  /** User-supplied label or auto-derived ("SOL → USDC every 24h"). */
  label: string;
  cadence: {
    /** Inter-cycle delay in ms. */
    intervalMs: number;
    /** Total cycles to run. -1 = unlimited (until cancelled). */
    totalCycles: number;
  };
  plan: DcaPlan;
  cyclesDone: number;
  createdAt: string; // ISO
  lastRunAt: string | null; // ISO
  nextFireAt: string; // ISO
  paused: boolean;
};

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readAll(): DcaSchedule[] {
  const ls = safeStorage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DcaSchedule[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(list: DcaSchedule[]): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* quota exceeded — runtime stays in-memory until next reload */
  }
}

let cache: DcaSchedule[] = readAll();
const subs = new Set<() => void>();
function notify(): void {
  for (const fn of subs) {
    try {
      fn();
    } catch {
      /* defensive */
    }
  }
}

export function subscribeSchedules(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listSchedules(): DcaSchedule[] {
  // Sorted by next-fire ascending so the UI shows what's coming next first.
  return [...cache].sort((a, b) =>
    a.nextFireAt.localeCompare(b.nextFireAt),
  );
}

export type CreateScheduleInput = {
  label?: string;
  cadence: { intervalMs: number; totalCycles: number };
  plan: DcaPlan;
  /** When to fire the first cycle. Defaults to now + intervalMs so the
   * user has the full first cadence to cancel before any swap fires. */
  firstFireAt?: Date;
};

function newId(): string {
  return `dca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createSchedule(input: CreateScheduleInput): DcaSchedule {
  const now = new Date();
  const first =
    input.firstFireAt ?? new Date(now.getTime() + input.cadence.intervalMs);
  const auto =
    input.label ??
    `${input.plan.inputSymbol} → ${input.plan.outputSymbol} every ${humanInterval(input.cadence.intervalMs)}`;
  const rec: DcaSchedule = {
    id: newId(),
    label: auto,
    cadence: { ...input.cadence },
    plan: { ...input.plan },
    cyclesDone: 0,
    createdAt: now.toISOString(),
    lastRunAt: null,
    nextFireAt: first.toISOString(),
    paused: false,
  };
  cache = [...cache, rec];
  writeAll(cache);
  notify();
  return rec;
}

export function cancelSchedule(id: string): void {
  cache = cache.filter((s) => s.id !== id);
  writeAll(cache);
  notify();
}

export function pauseSchedule(id: string, paused: boolean): void {
  cache = cache.map((s) => (s.id === id ? { ...s, paused } : s));
  writeAll(cache);
  notify();
}

/** Returns the first due, non-paused schedule. The runner uses this on
 * every tick; if it returns non-null, the runner attempts to fire. */
export function getDueSchedule(now: Date = new Date()): DcaSchedule | null {
  for (const s of cache) {
    if (s.paused) continue;
    if (new Date(s.nextFireAt).getTime() <= now.getTime()) return s;
  }
  return null;
}

/** Records that a schedule fired successfully. Bumps cyclesDone,
 * computes the next nextFireAt, and deletes when totalCycles is hit. */
export function markRan(id: string, when: Date = new Date()): void {
  cache = cache.flatMap((s) => {
    if (s.id !== id) return [s];
    const cyclesDone = s.cyclesDone + 1;
    if (
      s.cadence.totalCycles > 0 &&
      cyclesDone >= s.cadence.totalCycles
    ) {
      return []; // schedule complete — drop
    }
    const next = new Date(when.getTime() + s.cadence.intervalMs).toISOString();
    return [{ ...s, cyclesDone, lastRunAt: when.toISOString(), nextFireAt: next }];
  });
  writeAll(cache);
  notify();
}

/** Used when a fire fails or the user cancels mid-cycle. Pushes the
 * next fire forward so we don't busy-loop on a broken schedule. */
export function deferSchedule(id: string, deferMs: number): void {
  cache = cache.map((s) => {
    if (s.id !== id) return s;
    const next = new Date(Date.now() + deferMs).toISOString();
    return { ...s, nextFireAt: next };
  });
  writeAll(cache);
  notify();
}

// ---------------------------------------------------------------------------
// Helpers exported for the UI
// ---------------------------------------------------------------------------

export function humanInterval(ms: number): string {
  const h = Math.round(ms / 3600_000);
  if (h >= 24) {
    const d = Math.round(h / 24);
    return d === 1 ? "1 day" : `${d} days`;
  }
  if (h >= 1) return h === 1 ? "1 hour" : `${h} hours`;
  const m = Math.round(ms / 60_000);
  return `${m} min`;
}

export const CADENCE_PRESETS: { label: string; intervalMs: number }[] = [
  { label: "Every 1h", intervalMs: 60 * 60_000 },
  { label: "Every 6h", intervalMs: 6 * 60 * 60_000 },
  { label: "Every 24h", intervalMs: 24 * 60 * 60_000 },
  { label: "Every 3 days", intervalMs: 3 * 24 * 60 * 60_000 },
  { label: "Every 7 days", intervalMs: 7 * 24 * 60 * 60_000 },
];

/** Builds the ExecutionConfig the consumer hands to configure().
 * The wallet adapter + signers must be supplied at fire time. */
export function planToExecutionConfigShape(
  plan: DcaPlan,
  totalAmount: number,
): Omit<ExecutionConfig, "walletPublicKey" | "signTransaction" | "signAllTransactions" | "kaminoVaultAddress"> {
  return {
    inputMint: plan.inputMint,
    outputMint: plan.outputMint,
    totalAmount,
    sliceCount: plan.sliceCount,
    windowDurationMs: plan.windowDurationMs,
    slippageBps: plan.slippageBps,
    preSignEnabled: plan.preSignEnabled,
  };
}
