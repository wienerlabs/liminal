/**
 * LIMINAL — Multi-Tab Awareness
 *
 * Detects whether ANOTHER LIMINAL tab in the same browser profile has
 * an in-flight execution. Surfaces this to the UI so the user gets a
 * warning before starting a second concurrent execution that would
 * cause overlapping Solflare popups, racing localStorage writes, and
 * potentially duplicate / interleaved on-chain transactions.
 *
 * Detection strategy (two layers, both run in parallel):
 *
 *   1. BroadcastChannel (Chrome 54+, Firefox 38+, Safari 15+) — real-time
 *      pub/sub between tabs. Each tab broadcasts its current
 *      ExecutionStatus on every state change + a periodic heartbeat.
 *      Listeners track the latest status per tabId.
 *
 *   2. localStorage `storage` event (universal) — fallback for browsers
 *      where BroadcastChannel is unavailable. Fires when another tab
 *      writes our persisted execution state key. Coarser-grained
 *      (state must round-trip through serialize) but works everywhere.
 *
 * What this is NOT:
 *   - A leader election / lock primitive. We do not prevent the user
 *     from starting a second execution; we only warn them. Forcing a
 *     hard lock would conflict with the recovery flow (a refresh
 *     reincarnates the same tab and we don't want it to lock itself
 *     out).
 *   - A cross-tab state sync. Each tab keeps its own state machine.
 */

import { ExecutionStatus } from "../state/executionMachine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const CHANNEL_NAME = "liminal:multi-tab:v1";
const HEARTBEAT_MS = 5_000;
const STALE_AFTER_MS = 15_000;

/** Random per-tab identifier — survives the tab's full lifetime. */
const TAB_ID: string = `tab-${Math.random().toString(36).slice(2, 10)}`;

type Message = {
  tabId: string;
  status: ExecutionStatus;
  /** ms epoch — receivers use this to age-out stale tabs. */
  ts: number;
};

type Listener = (otherTabsInFlight: boolean) => void;

const STATE = {
  channel: null as BroadcastChannel | null,
  others: new Map<string, Message>(),
  listeners: new Set<Listener>(),
  initialized: false,
  heartbeatId: null as ReturnType<typeof setInterval> | null,
  lastBroadcast: ExecutionStatus.IDLE as ExecutionStatus,
};

// ---------------------------------------------------------------------------
// In-flight detection — derived from `others` map
// ---------------------------------------------------------------------------

const IN_FLIGHT_LITERAL: ReadonlySet<string> = new Set([
  ExecutionStatus.PREPARING,
  ExecutionStatus.DEPOSITING,
  ExecutionStatus.ACTIVE,
  ExecutionStatus.SLICE_WITHDRAWING,
  ExecutionStatus.SLICE_EXECUTING,
  ExecutionStatus.COMPLETING,
]);

function isInFlight(status: ExecutionStatus): boolean {
  return IN_FLIGHT_LITERAL.has(status);
}

function evictStale(): void {
  const cutoff = Date.now() - STALE_AFTER_MS;
  for (const [id, msg] of STATE.others) {
    if (msg.ts < cutoff) STATE.others.delete(id);
  }
}

function deriveOtherTabsInFlight(): boolean {
  evictStale();
  for (const msg of STATE.others.values()) {
    if (isInFlight(msg.status)) return true;
  }
  return false;
}

function notifyListeners(): void {
  const v = deriveOtherTabsInFlight();
  STATE.listeners.forEach((fn) => fn(v));
}

// ---------------------------------------------------------------------------
// Channel lifecycle
// ---------------------------------------------------------------------------

function init(): void {
  if (STATE.initialized) return;
  STATE.initialized = true;

  if (typeof window === "undefined") return; // SSR guard

  // BroadcastChannel layer (preferred).
  if (typeof BroadcastChannel !== "undefined") {
    try {
      STATE.channel = new BroadcastChannel(CHANNEL_NAME);
      STATE.channel.addEventListener("message", (e: MessageEvent<Message>) => {
        const msg = e.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.tabId === TAB_ID) return; // ignore self
        STATE.others.set(msg.tabId, msg);
        notifyListeners();
      });
    } catch {
      STATE.channel = null;
    }
  }

  // Storage event layer (fallback / additional signal). Triggers when
  // ANY other tab writes the persisted execution state. We don't read
  // the value — a write is enough to flag "another tab is doing
  // something" — but we DO debounce via timestamp.
  window.addEventListener("storage", (e) => {
    if (e.key !== "liminal:execution:state" || !e.newValue) return;
    try {
      const parsed = JSON.parse(e.newValue) as { status?: string };
      const status = parsed.status as ExecutionStatus | undefined;
      if (!status) return;
      // Synthesize a pseudo-tabId for the storage write (real tabId is
      // unknown). Single bucket — replaces previous storage-derived
      // entry. BroadcastChannel entries (with real tabIds) take
      // precedence on browsers that support both.
      STATE.others.set("storage", {
        tabId: "storage",
        status,
        ts: Date.now(),
      });
      notifyListeners();
    } catch {
      /* malformed — ignore */
    }
  });

  // Heartbeat — keeps our entry fresh in other tabs' eviction window
  // and re-broadcasts our status periodically (cheap insurance against
  // dropped messages).
  STATE.heartbeatId = setInterval(() => {
    broadcast(STATE.lastBroadcast);
    notifyListeners(); // also re-evaluate our local view
  }, HEARTBEAT_MS);

  // Goodbye on tab close — best effort. Receivers will also age us
  // out via STALE_AFTER_MS so this is just a faster signal.
  window.addEventListener("beforeunload", () => {
    if (!STATE.channel) return;
    try {
      STATE.channel.postMessage({
        tabId: TAB_ID,
        status: ExecutionStatus.IDLE,
        ts: Date.now(),
      });
    } catch {
      /* tab is dying anyway */
    }
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Broadcast our current execution status to all other tabs. Cheap to
 * call on every state change.
 */
export function broadcast(status: ExecutionStatus): void {
  init();
  STATE.lastBroadcast = status;
  if (!STATE.channel) return;
  try {
    STATE.channel.postMessage({
      tabId: TAB_ID,
      status,
      ts: Date.now(),
    });
  } catch {
    /* channel may have been closed */
  }
}

/**
 * Subscribe to other-tab in-flight status. Callback receives `true` if
 * any other tab is currently executing, `false` otherwise. Fires on
 * every change (debounced by the heartbeat tick + storage events).
 *
 * Returns an unsubscribe function. Idempotent on init.
 */
export function subscribeOtherTabsInFlight(
  cb: Listener,
): () => void {
  init();
  STATE.listeners.add(cb);
  // Fire once with current value so consumers don't need to poll.
  cb(deriveOtherTabsInFlight());
  return () => {
    STATE.listeners.delete(cb);
  };
}

/**
 * Get the current view synchronously. Useful for one-shot checks
 * (e.g. inside configureAction before throwing).
 */
export function getOtherTabsInFlight(): boolean {
  init();
  return deriveOtherTabsInFlight();
}

/** This tab's stable identifier. Exported for telemetry / debug. */
export const CURRENT_TAB_ID: string = TAB_ID;
