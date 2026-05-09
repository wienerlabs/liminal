/**
 * LIMINAL — useRoute hook
 *
 * Hafif, hash-based routing. react-router'ın 50KB+ ek bundle'ını taşımaktan
 * kaçınıyoruz çünkü 3 sabit route'umuz var ve URL parametrelerine ya da
 * iç içe nested route'lara ihtiyaç duymuyoruz.
 *
 * Routes:
 *   - "home"      → "" veya "#/" — Execute (ana giriş)
 *   - "wallet"    → "#/wallet"   — Wallet detay sayfası
 *   - "analytics" → "#/analytics"— Analytics detay sayfası
 *
 * Mobile bottom tab bar, header nav pill'leri ve in-app linkler
 * `navigate()` ile aynı state'e yazar; `hashchange` event'i tüm
 * subscriber'ları senkronize eder.
 */
import { useCallback, useEffect, useState } from "react";

export type Route = "home" | "wallet" | "analytics";

const ROUTE_HASH: Record<Route, string> = {
  home: "",
  wallet: "#/wallet",
  analytics: "#/analytics",
};

function parseHash(hash: string): Route {
  const h = hash.toLowerCase();
  if (h === "#/wallet" || h === "#wallet" || h === "#/wallet/") return "wallet";
  if (h === "#/analytics" || h === "#analytics" || h === "#/analytics/")
    return "analytics";
  return "home";
}

function readRouteNow(): Route {
  if (typeof window === "undefined") return "home";
  return parseHash(window.location.hash);
}

export function useRoute(): {
  route: Route;
  navigate: (r: Route) => void;
} {
  const [route, setRoute] = useState<Route>(() => readRouteNow());

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onHash = (): void => setRoute(readRouteNow());
    window.addEventListener("hashchange", onHash);
    // Initial sync — hash may have been set by deep link before mount.
    onHash();
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = useCallback((r: Route) => {
    if (typeof window === "undefined") return;
    const target = ROUTE_HASH[r];
    if (window.location.hash === target) return;
    // Use replaceState for "home" so we don't push an empty hash entry.
    if (r === "home") {
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      // hashchange fires only when hash actually changes — manually sync.
      setRoute("home");
    } else {
      window.location.hash = target;
    }
  }, []);

  return { route, navigate };
}
