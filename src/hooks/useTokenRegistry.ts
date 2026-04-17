/**
 * LIMINAL — useTokenRegistry hook
 *
 * Components pass a list of mints they care about; the hook warms up the
 * registry for those mints (lazy Jupiter v2 search per missing mint) and
 * triggers a re-render as each one lands. `lookup(mint)` is sync — returns
 * whatever is currently cached.
 *
 *   const { ready, lookup, symbol } = useTokenRegistry(mints);
 *   const t = lookup(mint);     // TokenInfo | null
 *   const s = symbol(mint);     // string (with Ab12…Xy89 fallback)
 *
 * Passing `mints` is optional — if omitted, the hook only subscribes and
 * does not trigger any fetches. Useful for components that just need
 * lookup on already-cached tokens.
 */

import { useCallback, useEffect, useState } from "react";
import {
  isRegistryLoaded,
  lookupToken,
  requestMany,
  subscribeRegistry,
  symbolFor,
  type TokenInfo,
} from "../services/tokenRegistry";

export type UseTokenRegistry = {
  ready: boolean;
  lookup: (mint: string) => TokenInfo | null;
  symbol: (mint: string) => string;
};

export function useTokenRegistry(mints?: readonly string[]): UseTokenRegistry {
  const [version, setVersion] = useState(0);

  // Subscribe once — any registry.set() from anywhere triggers a rerender.
  useEffect(() => {
    const unsub = subscribeRegistry(() => setVersion((v) => v + 1));
    return unsub;
  }, []);

  // Warm up when the list of mints changes (stringified so arrays of same
  // contents don't trigger re-fetch).
  const mintKey = mints?.join(",") ?? "";
  useEffect(() => {
    if (!mints || mints.length === 0) return;
    void requestMany(mints.slice());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintKey]);

  const lookup = useCallback(
    (mint: string) => lookupToken(mint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
  const symbol = useCallback(
    (mint: string) => symbolFor(mint),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );

  return { ready: isRegistryLoaded(), lookup, symbol };
}
