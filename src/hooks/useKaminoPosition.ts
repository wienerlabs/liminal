/**
 * LIMINAL — useKaminoPosition hook
 *
 * BLOK 4 (Kamino Entegrasyon Spesifikasyonu) altında LIMINAL'in yield
 * katmanına React binding'i.
 *
 * Sorumluluklar:
 * - Seçilen vault + token için canlı pozisyon tracking (30s polling).
 * - Deposit / partialWithdraw / finalWithdraw mutasyonları.
 * - Solflare signTransaction'ı dahili olarak kullanır — çağıran geçirmez.
 * - depositedAmount local state'te tutulur (on-chain'den okunamaz, BLOK 4).
 *
 * NOT: yieldAccrued, tracked depositedAmount üzerinden hesaplanır. Sayfa
 * yenilendiğinde local state sıfırlanır → tracked yield sıfırdan başlar.
 * Bu sınırlama BLOK 4'te açıkça kabul edilmiş bir trade-off'tur.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  deposit as kaminoDeposit,
  finalWithdraw as kaminoFinalWithdraw,
  getAvailableVaults,
  getPositionValue,
  partialWithdraw as kaminoPartialWithdraw,
  type KaminoPositionData,
  type KaminoVault,
} from "../services/kamino";
import {
  signTransactionWithSolflare,
  subscribeWallet,
  type WalletState,
} from "../services/solflare";

const REFRESH_INTERVAL_MS = 30_000;

export type UseKaminoPositionResult = {
  vault: KaminoVault | null;
  position: KaminoPositionData | null;
  isLoading: boolean;
  error: string | null;
  deposit: (
    amount: number,
  ) => Promise<{ signature: string; kTokenAmount: number }>;
  partialWithdraw: (
    tokenAmount: number,
  ) => Promise<{ signature: string; withdrawnAmount: number }>;
  finalWithdraw: () => Promise<{
    signature: string;
    totalAmount: number;
    yieldEarned: number;
  }>;
  refresh: () => Promise<void>;
};

export function useKaminoPosition(
  vaultMarketAddress: string,
  tokenMint: string,
): UseKaminoPositionResult {
  const [wallet, setWallet] = useState<WalletState>({
    connected: false,
    connecting: false,
    address: null,
  });
  const [vault, setVault] = useState<KaminoVault | null>(null);
  const [position, setPosition] = useState<KaminoPositionData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // BLOK 4: depositedAmount on-chain'den okunamaz, local state'te tutulur.
  // Bu ref wallet+vault+mint kombinasyonu değişse bile koruma gerektirir;
  // çağıran kullanım senaryosuna göre reset lojiği gerekirse ekle.
  const depositedAmountRef = useRef<number>(0);

  // Eş zamanlı çağrıları tekilleştirmek için.
  const isRefreshingRef = useRef<boolean>(false);

  // Wallet state abonelik.
  useEffect(() => {
    const unsubscribe = subscribeWallet(setWallet);
    return unsubscribe;
  }, []);

  // Vault/mint değiştiğinde tracked depositedAmount'u sıfırla — yeni bir
  // pozisyon bağlamı için yield sayacı baştan başlar.
  useEffect(() => {
    depositedAmountRef.current = 0;
  }, [vaultMarketAddress, tokenMint]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!vaultMarketAddress || !tokenMint) {
      setVault(null);
      setPosition(null);
      return;
    }
    if (!wallet.connected || !wallet.address) {
      setVault(null);
      setPosition(null);
      setError(null);
      return;
    }
    if (isRefreshingRef.current) return;

    isRefreshingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const walletPk = new PublicKey(wallet.address);
      const [vaults, positionData] = await Promise.all([
        getAvailableVaults(tokenMint),
        getPositionValue(
          walletPk,
          vaultMarketAddress,
          tokenMint,
          depositedAmountRef.current,
        ),
      ]);

      const matched =
        vaults.find((v) => v.marketAddress === vaultMarketAddress) ?? null;
      setVault(matched);
      setPosition(positionData);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Kamino pozisyonu alınırken beklenmeyen bir hata oluştu.",
      );
    } finally {
      setIsLoading(false);
      isRefreshingRef.current = false;
    }
  }, [wallet.connected, wallet.address, vaultMarketAddress, tokenMint]);

  // İlk yükleme + 30s polling.
  useEffect(() => {
    void refresh();
    if (!wallet.connected) return;
    const id = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh, wallet.connected]);

  // ---------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------

  const requireWallet = useCallback((): PublicKey => {
    if (!wallet.connected || !wallet.address) {
      throw new Error(
        "Solflare bağlı değil. İşlemi başlatmak için önce cüzdanınızı bağlayın.",
      );
    }
    return new PublicKey(wallet.address);
  }, [wallet.connected, wallet.address]);

  const deposit = useCallback(
    async (amount: number) => {
      const walletPk = requireWallet();
      const result = await kaminoDeposit(
        walletPk,
        vaultMarketAddress,
        tokenMint,
        amount,
        signTransactionWithSolflare,
      );
      depositedAmountRef.current += amount;
      await refresh();
      return result;
    },
    [requireWallet, vaultMarketAddress, tokenMint, refresh],
  );

  const partialWithdraw = useCallback(
    async (tokenAmount: number) => {
      const walletPk = requireWallet();
      const result = await kaminoPartialWithdraw(
        walletPk,
        vaultMarketAddress,
        tokenMint,
        tokenAmount,
        signTransactionWithSolflare,
      );
      await refresh();
      return result;
    },
    [requireWallet, vaultMarketAddress, tokenMint, refresh],
  );

  const finalWithdraw = useCallback(async () => {
    const walletPk = requireWallet();
    const result = await kaminoFinalWithdraw(
      walletPk,
      vaultMarketAddress,
      signTransactionWithSolflare,
      {
        tokenMint,
        trackedDepositedAmount: depositedAmountRef.current,
      },
    );
    // Tüm pozisyon çekildi → tracked principal sıfırlanır.
    depositedAmountRef.current = 0;
    await refresh();
    return result;
  }, [requireWallet, vaultMarketAddress, tokenMint, refresh]);

  return {
    vault,
    position,
    isLoading,
    error,
    deposit,
    partialWithdraw,
    finalWithdraw,
    refresh,
  };
}
