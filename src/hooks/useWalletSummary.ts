/**
 * LIMINAL — useWalletSummary hook
 *
 * Lightweight read-only summary of the connected wallet, designed to feed
 * the HeaderBar's connected-state badge. Intentionally narrower than the
 * `useAvailableTokens` hook in ExecutionPanel:
 *
 *   - Only SOL balance is fetched (single RPC call). The header doesn't
 *     enumerate every SPL token because that's expensive and the header
 *     just needs a "you're worth ~$X" anchor.
 *   - Only SOL/USD price is subscribed (single Pyth feed). 5s polling
 *     piggy-backs on the same `startPricePolling` plumbing the rest of
 *     the app uses, so the cost is negligible.
 *
 * Returns:
 *   - `solBalance`     — number of SOL (decimal), or null when unknown
 *   - `solPriceUsd`    — last known SOL/USD price, or null when unknown
 *   - `solUsdValue`    — solBalance × solPriceUsd, or null when either side
 *                        is missing
 *   - `connected`      — wallet connection flag (mirrors solflare service)
 *   - `loading`        — true while the initial balance fetch is in flight
 *
 * On disconnect everything resets to nulls so the header can fall back to
 * its "Not connected" treatment without flicker.
 */

import { useEffect, useState } from "react";
import {
  getSOLBalance,
  getWalletState,
  subscribeWallet,
  type WalletState,
} from "../services/solflare";
import { usePriceMonitor } from "./usePriceMonitor";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export type WalletSummary = {
  connected: boolean;
  solBalance: number | null;
  solPriceUsd: number | null;
  solUsdValue: number | null;
  loading: boolean;
};

const EMPTY: WalletSummary = {
  connected: false,
  solBalance: null,
  solPriceUsd: null,
  solUsdValue: null,
  loading: false,
};

export function useWalletSummary(): WalletSummary {
  const [wallet, setWallet] = useState<WalletState>(() => getWalletState());
  useEffect(() => subscribeWallet(setWallet), []);

  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Re-fetch SOL balance whenever the connected address changes. The
  // solflare service emits wallet state updates on connect / disconnect /
  // address change; we lean on those rather than polling here. (The
  // ExecutionPanel still drives its own balance polling via
  // useAvailableTokens, so total RPC pressure stays bounded.)
  useEffect(() => {
    if (!wallet.connected || !wallet.address) {
      setSolBalance(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const address = wallet.address;
    void (async () => {
      try {
        const bal = await getSOLBalance(address);
        if (!cancelled) setSolBalance(bal);
      } catch {
        if (!cancelled) setSolBalance(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wallet.connected, wallet.address]);

  // Subscribe to SOL/USD only when connected — usePriceMonitor handles the
  // empty-array no-op gracefully when we hand it [].
  const mints = wallet.connected ? [SOL_MINT] : [];
  const { prices } = usePriceMonitor(mints, 5_000);
  const solPriceUsd = wallet.connected ? (prices[SOL_MINT] ?? null) : null;

  if (!wallet.connected) return EMPTY;

  const solUsdValue =
    solBalance != null && solPriceUsd != null
      ? solBalance * solPriceUsd
      : null;

  return {
    connected: true,
    solBalance,
    solPriceUsd,
    solUsdValue,
    loading,
  };
}
