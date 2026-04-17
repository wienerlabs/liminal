/**
 * LIMINAL — useActiveKaminoPositions
 *
 * Surfaces every active deposit the connected wallet has on Kamino Main
 * Market, independent of any in-progress LIMINAL execution. Powers the
 * emergency-withdraw affordance: when a LIMINAL execution errors out with
 * funds still parked in Kamino, the user can always see what's parked and
 * jump to the Kamino app to pull it out manually.
 *
 * Polling cadence: 30s — infrequent enough that free-tier RPC limits
 * don't get hammered, frequent enough that a post-execution withdraw
 * reflects in the UI quickly.
 *
 * Data shape: one row per reserve the wallet has a non-zero deposit on.
 * Sorted by USD value descending so the largest position surfaces first.
 */

import { useEffect, useRef, useState } from "react";
import {
  getActivePositions,
  type ActiveKaminoPosition,
} from "../services/kamino";

const POLL_INTERVAL_MS = 30_000;

export type UseActiveKaminoPositions = {
  positions: ActiveKaminoPosition[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useActiveKaminoPositions(
  walletAddress: string | null,
): UseActiveKaminoPositions {
  const [positions, setPositions] = useState<ActiveKaminoPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  const fetchPositions = async (): Promise<void> => {
    if (!walletAddress) {
      setPositions([]);
      setError(null);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const rows = await getActivePositions(walletAddress);
      setPositions(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    void fetchPositions();
    if (!walletAddress) return;
    const id = setInterval(() => void fetchPositions(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress]);

  return { positions, loading, error, refresh: fetchPositions };
}
