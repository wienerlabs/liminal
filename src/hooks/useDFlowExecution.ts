/**
 * LIMINAL — useDFlowExecution hook
 *
 * BLOK 3 (DFlow Entegrasyon Spesifikasyonu) için React binding'i.
 * Quote alma ve swap execute akışlarını tek bir hook arkasına yerleştirir.
 *
 * Davranış:
 * - `getQuote` çağrısı isQuoting flag'ini yönetir, lastQuote'u günceller.
 * - `executeSwap` çağrısı isExecuting flag'ini yönetir, lastResult'u günceller.
 * - Hata durumunda `error` set edilir; bir sonraki başarılı işlemde temizlenir
 *   (user spec: "bir sonraki başarılı işlemde temizlenir").
 * - Solflare signTransaction hook içinde adapter'dan otomatik alınır —
 *   çağıranın dışarıdan geçirmesine gerek yok.
 */

import { useCallback, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  executeSwap as dflowExecuteSwap,
  getQuote as dflowGetQuote,
  type DFlowQuote,
  type ExecutionResult,
} from "../services/dflow";
import {
  getWalletState,
  signTransactionWithSolflare,
} from "../services/solflare";

export type UseDFlowExecutionResult = {
  /** Verilen pair + miktar + slippage için DFlow'dan taze quote çeker. */
  getQuote: (amount: number) => Promise<DFlowQuote>;
  /** Son alınan quote'u (veya verilen quote'u) execute eder. */
  executeSwap: (quote?: DFlowQuote) => Promise<ExecutionResult>;
  lastQuote: DFlowQuote | null;
  lastResult: ExecutionResult | null;
  isQuoting: boolean;
  isExecuting: boolean;
  error: string | null;
};

export function useDFlowExecution(
  inputMint: string,
  outputMint: string,
  slippageBps: number,
): UseDFlowExecutionResult {
  const [lastQuote, setLastQuote] = useState<DFlowQuote | null>(null);
  const [lastResult, setLastResult] = useState<ExecutionResult | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getQuote = useCallback(
    async (amount: number): Promise<DFlowQuote> => {
      setIsQuoting(true);
      try {
        const quote = await dflowGetQuote(
          inputMint,
          outputMint,
          amount,
          slippageBps,
        );
        setLastQuote(quote);
        setError(null); // başarı → önceki hatayı temizle
        return quote;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "DFlow quote alınırken beklenmeyen bir hata oluştu.";
        setError(message);
        throw err;
      } finally {
        setIsQuoting(false);
      }
    },
    [inputMint, outputMint, slippageBps],
  );

  const executeSwap = useCallback(
    async (quote?: DFlowQuote): Promise<ExecutionResult> => {
      const target = quote ?? lastQuote;
      if (!target) {
        const msg =
          "Execute edilecek bir quote yok. Önce getQuote() çağrısı yapın.";
        setError(msg);
        throw new Error(msg);
      }

      const wallet = getWalletState();
      if (!wallet.connected || !wallet.address) {
        const msg =
          "Solflare bağlı değil. Execute için önce cüzdanınızı bağlayın.";
        setError(msg);
        throw new Error(msg);
      }

      setIsExecuting(true);
      try {
        const walletPk = new PublicKey(wallet.address);
        const result = await dflowExecuteSwap(
          walletPk,
          target,
          signTransactionWithSolflare,
        );
        // Mint bilgisi execute'ta hook context'inden doldurulur —
        // service tarafı pair'i bilmediği için boş döner.
        const enriched: ExecutionResult = {
          ...result,
          inputMint,
          outputMint,
        };
        setLastResult(enriched);
        setError(null); // başarı → önceki hatayı temizle
        return enriched;
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "DFlow execute sırasında beklenmeyen bir hata oluştu.";
        setError(message);
        throw err;
      } finally {
        setIsExecuting(false);
      }
    },
    [lastQuote, inputMint, outputMint],
  );

  return {
    getQuote,
    executeSwap,
    lastQuote,
    lastResult,
    isQuoting,
    isExecuting,
    error,
  };
}
