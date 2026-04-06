/**
 * LIMINAL — useNetworkStatus hook
 *
 * Every 30s, measures RPC latency via connection.getSlot() timing.
 * Green < 500ms, amber 500-2000ms, red on error.
 */

import { useEffect, useState } from "react";
import { createConnection } from "../services/quicknode";

export type NetworkStatusState = {
  status: "connected" | "slow" | "offline";
  latencyMs: number | null;
  slot: number | null;
};

const POLL_INTERVAL_MS = 30_000;

export function useNetworkStatus(): NetworkStatusState {
  const [state, setState] = useState<NetworkStatusState>({
    status: "offline",
    latencyMs: null,
    slot: null,
  });

  useEffect(() => {
    let cancelled = false;

    const check = async (): Promise<void> => {
      try {
        const conn = createConnection();
        const start = performance.now();
        const slot = await conn.getSlot("confirmed");
        const latencyMs = performance.now() - start;
        if (cancelled) return;

        setState({
          status: latencyMs < 500 ? "connected" : latencyMs < 2000 ? "slow" : "offline",
          latencyMs,
          slot,
        });
      } catch {
        if (cancelled) return;
        setState({ status: "offline", latencyMs: null, slot: null });
      }
    };

    void check();
    const id = setInterval(() => void check(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return state;
}
