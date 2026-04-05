/**
 * LIMINAL — Central Error Handler
 *
 * Tüm effect fonksiyonlarının catch blokları bu `parseError` fonksiyonuna
 * yönlendirilir. Ham hata doğrudan state'e yazılmaz — her zaman bu
 * classifier'dan geçer. Kullanıcıya dönük mesajlar Türkçe, teknik loglar
 * console'a bırakılır.
 *
 * Pattern matching stratejisi:
 *   1. Önce spesifik Solana RPC hata mesajları (timeout, blockhash, rent, 0x1)
 *   2. Solflare wallet hataları (rejection, disconnection)
 *   3. DFlow hataları (quote expired, slippage)
 *   4. Kamino hataları (insufficient liquidity, reserve stale)
 *   5. Tanınmayan → UNKNOWN + tam logla
 *
 * Yeni hata tipleri eklemek kolay: ilgili bölüme yeni bir regex + classifier
 * eklemek yeterli, fonksiyonun genel yapısı değişmez.
 */

import {
  ErrorCode,
  type ExecutionError,
} from "../state/executionMachine";

export type ParseErrorPhase =
  | "kamino-deposit"
  | "kamino-withdraw"
  | "kamino-final"
  | "dflow-quote"
  | "dflow-swap"
  | "batch";

/**
 * Ham hatayı `ExecutionError`'a dönüştürür. Opsiyonel `sliceIndex` ve
 * `phase` parametreleri hatayı zenginleştirir — phase, pattern match
 * başarısız olduğunda fallback ErrorCode'u belirlemeye yardım eder.
 */
export function parseError(
  error: unknown,
  sliceIndex: number | null = null,
  phase: ParseErrorPhase | null = null,
): ExecutionError {
  const rawMessage = extractMessage(error);
  const code4001 = extractCode(error) === 4001;
  const timestamp = new Date();

  // --- Solana RPC errors -------------------------------------------------
  if (/transaction was not confirmed/i.test(rawMessage)) {
    const secs = rawMessage.match(/(\d+)\s*seconds?/i)?.[1] ?? "60";
    return {
      code: ErrorCode.TRANSACTION_TIMEOUT,
      message: `Transaction was not confirmed in ${secs}s. Network is congested, please retry.`,
      sliceIndex,
      retryable: true,
      timestamp,
    };
  }

  if (/blockhash not found/i.test(rawMessage)) {
    return {
      code: ErrorCode.TRANSACTION_TIMEOUT,
      message: "Blockhash expired. The transaction will be resent.",
      sliceIndex,
      retryable: true,
      timestamp,
    };
  }

  if (/insufficientfundsforrent|insufficient funds for rent/i.test(rawMessage)) {
    return {
      code: ErrorCode.UNKNOWN,
      message:
        "Not enough SOL for account rent. Add a small amount of SOL to your wallet.",
      sliceIndex,
      retryable: false,
      timestamp,
    };
  }

  if (/0x[0-9a-f]+|custom program error/i.test(rawMessage)) {
    console.error("[LIMINAL] Custom program error:", error);
    return {
      code: ErrorCode.UNKNOWN,
      message: `Program error occurred. Detail: ${truncate(rawMessage, 140)}`,
      sliceIndex,
      retryable: false,
      timestamp,
    };
  }

  // --- Solflare wallet errors --------------------------------------------
  if (code4001 || /user rejected|rejected in wallet/i.test(rawMessage)) {
    return {
      code: ErrorCode.WALLET_REJECTED,
      message:
        "Transaction rejected in wallet. Click 'Retry' to approve again.",
      sliceIndex,
      retryable: true,
      timestamp,
    };
  }

  if (/wallet not connected|solflare not connected/i.test(rawMessage)) {
    return {
      code: ErrorCode.WALLET_REJECTED,
      message:
        "Wallet disconnected. Refresh the page and reconnect.",
      sliceIndex,
      retryable: false,
      timestamp,
    };
  }

  // --- DFlow errors ------------------------------------------------------
  if (/quote expired/i.test(rawMessage)) {
    return {
      code: ErrorCode.DFLOW_QUOTE_EXPIRED,
      message:
        "DFlow quote expired. A new quote will be fetched and retried.",
      sliceIndex,
      retryable: true,
      timestamp,
    };
  }

  if (/slippage tolerance exceeded|current slippage|slippage.+(limit|exceed)/i.test(rawMessage)) {
    return {
      code: ErrorCode.SLIPPAGE_EXCEEDED,
      message:
        "Slippage limit exceeded. The slice will retry once the price recovers.",
      sliceIndex,
      retryable: true,
      timestamp,
    };
  }

  // --- Kamino errors -----------------------------------------------------
  if (/insufficient liquidity/i.test(rawMessage)) {
    return {
      code: ErrorCode.KAMINO_INSUFFICIENT_LIQUIDITY,
      message:
        "Not enough liquidity in Kamino vault. Withdrawal is currently unavailable.",
      sliceIndex,
      retryable: false,
      timestamp,
    };
  }

  if (/reserve.*stale|stale.*reserve/i.test(rawMessage)) {
    return {
      code: ErrorCode.KAMINO_WITHDRAW_FAILED,
      message:
        "Kamino reserve data is updating, will retry shortly.",
      sliceIndex,
      retryable: true,
      timestamp,
    };
  }

  // --- Batch simulation specific -----------------------------------------
  if (/simulation (failed|unsuccessful)/i.test(rawMessage)) {
    return {
      code: ErrorCode.DFLOW_SIMULATION_FAILED,
      message: rawMessage,
      sliceIndex,
      retryable: true,
      timestamp,
    };
  }

  // --- Phase-based fallback ----------------------------------------------
  if (phase) {
    const fallback = phaseFallback(phase, rawMessage, sliceIndex, timestamp);
    if (fallback) return fallback;
  }

  // --- Unrecognized: UNKNOWN + log ---------------------------------------
  console.error("[LIMINAL] parseError unrecognized:", error);
  return {
    code: ErrorCode.UNKNOWN,
    message: `Unexpected error: ${truncate(rawMessage, 100)}`,
    sliceIndex,
    retryable: false,
    timestamp,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error ?? "unknown error");
}

function extractCode(error: unknown): number | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") return code;
  }
  return undefined;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...";
}

function phaseFallback(
  phase: ParseErrorPhase,
  rawMessage: string,
  sliceIndex: number | null,
  timestamp: Date,
): ExecutionError | null {
  const mkErr = (code: ErrorCode, retryable: boolean): ExecutionError => ({
    code,
    message: `${phaseLabel(phase)}: ${truncate(rawMessage, 140)}`,
    sliceIndex,
    retryable,
    timestamp,
  });

  switch (phase) {
    case "kamino-deposit":
      return mkErr(ErrorCode.KAMINO_DEPOSIT_FAILED, true);
    case "kamino-withdraw":
    case "kamino-final":
      return mkErr(ErrorCode.KAMINO_WITHDRAW_FAILED, true);
    case "dflow-quote":
      return mkErr(ErrorCode.DFLOW_QUOTE_FAILED, true);
    case "dflow-swap":
      return mkErr(ErrorCode.DFLOW_EXECUTION_FAILED, true);
    case "batch":
      return mkErr(ErrorCode.DFLOW_EXECUTION_FAILED, true);
    default:
      return null;
  }
}

function phaseLabel(phase: ParseErrorPhase): string {
  switch (phase) {
    case "kamino-deposit":
      return "Kamino deposit";
    case "kamino-withdraw":
      return "Kamino withdraw";
    case "kamino-final":
      return "Kamino final withdraw";
    case "dflow-quote":
      return "DFlow quote";
    case "dflow-swap":
      return "DFlow swap";
    case "batch":
      return "Batch execution";
  }
}
