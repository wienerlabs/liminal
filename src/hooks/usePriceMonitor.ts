/**
 * LIMINAL — usePriceMonitor hook
 *
 * BLOK 5 (Quicknode Senaryo 1: Real-Time Fiyat Monitoring) tarafında
 * bileşenlerin gerçek zamanlı Pyth fiyatlarına abone olması için ince
 * bir sarmalayıcı.
 *
 * Davranış:
 * - Mount'ta `startPricePolling` başlatır, unmount'ta cleanup çağrılır.
 * - tokenMints değişirse polling yeniden kurulur (set semantic ile karşılaştırılır).
 * - Her başarılı tick `lastUpdated`'ı günceller.
 * - Ardışık 3 tick başarısız olursa `error` set edilir. Tek hata error
 *   göstermez — flicker'ı önlemek için (BLOK 7 loading/error disiplini).
 * - Bir token'ın fiyatı alınamazsa o token `prices` map'inde yer almaz;
 *   diğer token'lar etkilenmez.
 */

import { useEffect, useRef, useState } from "react";
import { startPricePolling, type PriceMap } from "../services/quicknode";

export type PriceMonitorState = {
  prices: PriceMap;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
};

const CONSECUTIVE_ERROR_THRESHOLD = 3;
const DEFAULT_INTERVAL_MS = 5_000;

export function usePriceMonitor(
  tokenMints: string[],
  intervalMs: number = DEFAULT_INTERVAL_MS,
): PriceMonitorState {
  const [prices, setPrices] = useState<PriceMap>({});
  const [isLoading, setIsLoading] = useState<boolean>(tokenMints.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Stabil dependency key — aynı içerikli ama farklı referanslı array'lerde
  // useEffect'in tekrar çalışmasını engeller.
  const mintsKey = [...tokenMints].sort().join(",");
  const errorCountRef = useRef(0);

  useEffect(() => {
    if (tokenMints.length === 0) {
      setPrices({});
      setIsLoading(false);
      setError(null);
      setLastUpdated(null);
      errorCountRef.current = 0;
      return;
    }

    setIsLoading(true);
    setError(null);
    errorCountRef.current = 0;

    const cleanup = startPricePolling(tokenMints, intervalMs, (next) => {
      const gotAny = Object.keys(next).length > 0;

      if (!gotAny) {
        errorCountRef.current += 1;
        if (errorCountRef.current >= CONSECUTIVE_ERROR_THRESHOLD) {
          setError(
            "Fiyat verisi alınamıyor. Pyth feed'lerine bağlantı kurulamadı.",
          );
          setIsLoading(false);
        }
        // Tek/iki hatada sessizce bekle — hook error göstermez.
        return;
      }

      errorCountRef.current = 0;
      setPrices(next);
      setLastUpdated(new Date());
      setError(null);
      setIsLoading(false);
    });

    return cleanup;
    // mintsKey bilerek kullanılıyor (array identity yerine içerik karşılaştırması).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintsKey, intervalMs]);

  return { prices, isLoading, error, lastUpdated };
}
