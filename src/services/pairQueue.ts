/**
 * LIMINAL — pairQueue
 *
 * Sequential swap queue. The user fills out plan A, plan B, plan C,
 * and the queue runner executes them one after another: each plan
 * starts only when the previous one reaches DONE. Failed runs (ERROR
 * status) cancel the rest of the queue by default.
 *
 * Distinct from DCA in that DCA repeats the SAME plan on a cadence;
 * pairQueue runs DIFFERENT plans back-to-back. Useful for portfolio
 * rebalancing ("swap SOL→USDC, then USDC→JUP, then JUP→JTO").
 *
 * Local-first like DCA — the runner ticks every 30s, fires the next
 * pending plan when the machine is IDLE/CONFIGURED. Tab must stay
 * open. Schema designed so a future server-side runner could pick
 * the queue up via the same JSON shape.
 *
 * Storage: liminal:pairQueue:v1, single active queue at a time. Keep
 * it simple: if you want concurrency, queue them as DCA schedules.
 */

export type QueueStep = {
  /** Stable id for keying / cancellation. */
  id: string;
  inputMint: string;
  outputMint: string;
  inputSymbol: string;
  outputSymbol: string;
  /** Total token amount to swap on this step. */
  amount: number;
  windowDurationMs: number;
  sliceCount: number;
  slippageBps: number;
  preSignEnabled: boolean;
  /** "pending" until fired; "active" while in flight; "done" once
   * the machine reports DONE; "skipped" if cancelled mid-run. */
  status: "pending" | "active" | "done" | "skipped" | "error";
  /** ISO of when the step transitioned to active / completed. */
  startedAt: string | null;
  completedAt: string | null;
  /** Captured value-capture USD on completion (mirrored from
   * analyticsStore so we can show queue-level totals without
   * re-querying). */
  resultGainUsd: number | null;
};

export type PairQueue = {
  id: string;
  label: string;
  createdAt: string;
  steps: QueueStep[];
  /** When ERROR is encountered, default behaviour: stop. Setting
   * this to "continue" makes the runner skip the failed step and
   * proceed. Default "stop". */
  onError: "stop" | "continue";
};

const STORAGE_KEY = "liminal:pairQueue:v1";

function safeStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(): PairQueue | null {
  const ls = safeStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PairQueue;
  } catch {
    return null;
  }
}

function write(q: PairQueue | null): void {
  const ls = safeStorage();
  if (!ls) return;
  try {
    if (q === null) ls.removeItem(STORAGE_KEY);
    else ls.setItem(STORAGE_KEY, JSON.stringify(q));
  } catch {
    /* ignore */
  }
}

let cache: PairQueue | null = read();
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

export function subscribePairQueue(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

export function getActiveQueue(): PairQueue | null {
  return cache;
}

function nid(): string {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export type CreateQueueInput = {
  label?: string;
  onError?: "stop" | "continue";
  steps: Omit<QueueStep, "id" | "status" | "startedAt" | "completedAt" | "resultGainUsd">[];
};

export function createQueue(input: CreateQueueInput): PairQueue {
  if (!input.steps || input.steps.length === 0) {
    throw new Error("Queue requires at least one step.");
  }
  const q: PairQueue = {
    id: nid(),
    label:
      input.label ??
      `${input.steps.length}-step queue (${input.steps.map((s) => `${s.inputSymbol}→${s.outputSymbol}`).join(" · ")})`,
    createdAt: new Date().toISOString(),
    onError: input.onError ?? "stop",
    steps: input.steps.map((s) => ({
      ...s,
      id: nid(),
      status: "pending",
      startedAt: null,
      completedAt: null,
      resultGainUsd: null,
    })),
  };
  cache = q;
  write(cache);
  notify();
  return q;
}

export function clearQueue(): void {
  cache = null;
  write(null);
  notify();
}

/** Returns the first non-completed step, or null if the queue is
 * empty / fully done / fully aborted. */
export function getNextStep(): QueueStep | null {
  if (!cache) return null;
  return (
    cache.steps.find(
      (s) => s.status === "pending" || s.status === "active",
    ) ?? null
  );
}

export function markStepActive(stepId: string): void {
  if (!cache) return;
  cache = {
    ...cache,
    steps: cache.steps.map((s) =>
      s.id === stepId
        ? { ...s, status: "active", startedAt: new Date().toISOString() }
        : s,
    ),
  };
  write(cache);
  notify();
}

export function markStepDone(stepId: string, gainUsd: number): void {
  if (!cache) return;
  cache = {
    ...cache,
    steps: cache.steps.map((s) =>
      s.id === stepId
        ? {
            ...s,
            status: "done",
            completedAt: new Date().toISOString(),
            resultGainUsd: gainUsd,
          }
        : s,
    ),
  };
  // Auto-clear when fully done so the runner doesn't keep ticking.
  if (cache.steps.every((s) => s.status === "done" || s.status === "skipped" || s.status === "error")) {
    // Keep the queue around in localStorage for one final render
    // but mark it as fully complete; consumer can call clearQueue()
    // when the user dismisses.
  }
  write(cache);
  notify();
}

export function markStepError(stepId: string, _reason: string): void {
  if (!cache) return;
  cache = {
    ...cache,
    steps: cache.steps.map((s) =>
      s.id === stepId
        ? { ...s, status: "error", completedAt: new Date().toISOString() }
        : s,
    ),
  };
  write(cache);
  notify();
}

export function skipStep(stepId: string): void {
  if (!cache) return;
  cache = {
    ...cache,
    steps: cache.steps.map((s) =>
      s.id === stepId ? { ...s, status: "skipped" } : s,
    ),
  };
  write(cache);
  notify();
}

export function isQueueComplete(): boolean {
  if (!cache) return true;
  return cache.steps.every(
    (s) => s.status === "done" || s.status === "skipped" || s.status === "error",
  );
}

export function totalCapturedUsd(): number {
  if (!cache) return 0;
  return cache.steps.reduce(
    (sum, s) => sum + (s.resultGainUsd ?? 0),
    0,
  );
}
