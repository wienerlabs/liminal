/**
 * LIMINAL — Pre-execution balance check
 *
 * Runs BEFORE `depositEffect` so the user sees a confirmation card with
 * concrete numbers (wallet input balance, existing Kamino position,
 * per-slice withdraw size, SOL gas budget) and approves the execution
 * with their eyes open. Stops the most common demo failure — an
 * `InstructionError[*, {"Custom":1}]` from Kamino partial-withdraw or
 * Token program when the wallet doesn't actually have the funds the
 * configured plan needs.
 *
 * Pure helper — no React, no state machine mutation. UI consumes the
 * `PreCheckResult` and decides whether to surface confirm/cancel.
 *
 * Why a separate module (not folded into executionMachine):
 *   - Keeps the state machine status enum unchanged so persisted
 *     localStorage state from older builds stays loadable.
 *   - Easier to unit-test in isolation.
 *   - Surfaces explicit "warning vs. blocker" semantics — the state
 *     machine only knows "OK / ERROR".
 */

import { PublicKey } from "@solana/web3.js";
import {
  getSOLBalance,
  getSPLTokenBalances,
  resolveTokenSymbol,
} from "./quicknode";
import { getPositionValue } from "./kamino";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PreCheckInput = {
  walletAddress: string;
  inputMint: string;
  /** Total amount the user is about to deposit (human units, not lamports). */
  totalAmount: number;
  sliceCount: number;
  kaminoVaultAddress: string;
};

export type PreCheckIssue = {
  /** "blocker" means START should be disabled until resolved; "warning"
   *  means the UI shows a yellow caution but the user may still proceed. */
  severity: "blocker" | "warning";
  code: PreCheckIssueCode;
  message: string;
};

export type PreCheckIssueCode =
  | "INSUFFICIENT_INPUT_TOKEN"
  | "INSUFFICIENT_SOL_GAS"
  | "EXISTING_KAMINO_POSITION"
  | "WALLET_BALANCE_UNREADABLE"
  | "KAMINO_READ_FAILED";

export type PreCheckResult = {
  /** Resolved symbol for the input mint (e.g. "USDC"); falls back to a
   *  shortened mint id if Jupiter / our registry can't resolve it. */
  inputSymbol: string;
  /** Wallet's current SPL balance for the input mint (human units). */
  walletInputBalance: number;
  /** Wallet's current native SOL balance (human units). */
  walletSolBalance: number;
  /** Existing Kamino position for this token, if any. 0 when fresh. */
  kaminoExistingPosition: number;
  /** Per-slice withdraw size shown to the user (n-1 slices; the last
   *  slice absorbs float-drift residual so the n-th is slightly different). */
  perSliceAmount: number;
  /** Same totalAmount echoed back for the banner copy. */
  totalAmount: number;
  /** sliceCount echoed back. */
  sliceCount: number;
  /** All issues — blockers and warnings combined; empty array = green. */
  issues: PreCheckIssue[];
  /** Convenience: true iff every issue is severity="warning". */
  canProceed: boolean;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Minimum SOL the wallet should hold for the entire execution.
 *
 *   - ~0.000005 SOL per signature × (1 deposit + sliceCount batched +
 *     1 final withdraw + autopilot's 2 setup/cleanup popups) is the
 *     hard requirement (~0.00005 SOL worst-case).
 *   - Each new token ATA we touch costs ~0.002 SOL rent-exempt; with
 *     output token + intermediate hops that's another ~0.005 SOL.
 *   - We pad to 0.05 SOL — well over worst case, leaves room for a
 *     priority-fee bump on congestion without surprising the user.
 *
 * This is the same threshold ExecutionPanel uses in its "max amount"
 * helper — keeping it in one place avoids drift.
 */
const MIN_SOL_GAS_BUDGET = 0.05;

/**
 * Tolerance for the wallet-balance-vs-totalAmount comparison. Floating
 * point precision on the SPL parsedAmount can produce a tiny shortfall
 * (e.g. 99.99999998 vs 100). Without a tolerance the user sees a
 * blocker on what is effectively an exact match.
 */
const BALANCE_EPSILON = 1e-9;

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Run all pre-checks in parallel and produce a single result object.
 *
 * Failures inside individual fetches don't throw — they degrade into
 * `WALLET_BALANCE_UNREADABLE` / `KAMINO_READ_FAILED` issues so the UI
 * can still render a meaningful card (network blip shouldn't block
 * the user; we just can't tell them what's there).
 */
export async function precheckBalances(
  input: PreCheckInput,
): Promise<PreCheckResult> {
  const { walletAddress, inputMint, totalAmount, sliceCount, kaminoVaultAddress } =
    input;

  // Symbol resolution is synchronous — pulled straight from the
  // mint→symbol map; no need to wrap in Promise.
  const inputSymbolFromRegistry = resolveTokenSymbol(inputMint);

  const walletPubkey = new PublicKey(walletAddress);

  // ---- Parallel reads ------------------------------------------------------
  const [solRes, balRes, posRes] = await Promise.allSettled([
    getSOLBalance(walletAddress),
    getSPLTokenBalances(walletAddress),
    getPositionValue(walletPubkey, kaminoVaultAddress, inputMint, 0),
  ]);

  const issues: PreCheckIssue[] = [];

  // ---- SOL balance ---------------------------------------------------------
  const walletSolBalance = solRes.status === "fulfilled" ? solRes.value : 0;
  if (solRes.status === "rejected") {
    issues.push({
      severity: "warning",
      code: "WALLET_BALANCE_UNREADABLE",
      message:
        "SOL balance could not be read from RPC. Network may be flaky — proceed at your own risk.",
    });
  } else if (walletSolBalance < MIN_SOL_GAS_BUDGET) {
    issues.push({
      severity: "blocker",
      code: "INSUFFICIENT_SOL_GAS",
      message:
        `Wallet has ${walletSolBalance.toFixed(4)} SOL — at least ${MIN_SOL_GAS_BUDGET} SOL ` +
        "is recommended for transaction fees + ATA rent across the full TWAP window.",
    });
  }

  // ---- Input token balance -------------------------------------------------
  let walletInputBalance = 0;
  if (balRes.status === "fulfilled") {
    const match = balRes.value.find((b) => b.mint === inputMint);
    // Field is `balance` on TokenBalance (services/quicknode.ts), not
    // `amount` — getting that wrong silently reads 0 and falsely flags
    // every wallet as under-funded.
    walletInputBalance = match?.balance ?? 0;
  } else {
    issues.push({
      severity: "warning",
      code: "WALLET_BALANCE_UNREADABLE",
      message:
        "Token balance could not be read from RPC. Proceed only if you trust your displayed wallet state.",
    });
  }

  // resolveTokenSymbol returns the mint itself for unknown mints; only
  // override with a short-form if we got that fallback shape.
  const inputSymbolResolved =
    inputSymbolFromRegistry && inputSymbolFromRegistry !== inputMint
      ? inputSymbolFromRegistry
      : `${inputMint.slice(0, 4)}…${inputMint.slice(-4)}`;

  if (
    balRes.status === "fulfilled" &&
    walletInputBalance + BALANCE_EPSILON < totalAmount
  ) {
    issues.push({
      severity: "blocker",
      code: "INSUFFICIENT_INPUT_TOKEN",
      message:
        `Wallet has ${walletInputBalance.toFixed(6)} ${inputSymbolResolved} but the plan ` +
        `requires ${totalAmount.toFixed(6)} ${inputSymbolResolved}. Reduce the amount or top up.`,
    });
  }

  // ---- Existing Kamino position -------------------------------------------
  let kaminoExistingPosition = 0;
  if (posRes.status === "fulfilled") {
    kaminoExistingPosition = posRes.value.tokenValue;
    if (kaminoExistingPosition > 0) {
      issues.push({
        severity: "warning",
        code: "EXISTING_KAMINO_POSITION",
        message:
          `Wallet already has ${kaminoExistingPosition.toFixed(6)} ${inputSymbolResolved} ` +
          "deposited in this Kamino reserve from a prior execution. The new deposit will " +
          "add on top; the final withdraw at DONE will drain everything — including the " +
          "older position.",
      });
    }
  } else {
    issues.push({
      severity: "warning",
      code: "KAMINO_READ_FAILED",
      message:
        "Kamino position read failed. Existing positions (if any) won't be visible until RPC recovers.",
    });
  }

  // ---- Per-slice math ------------------------------------------------------
  const perSliceAmount = sliceCount > 0 ? totalAmount / sliceCount : 0;

  // ---- Aggregate -----------------------------------------------------------
  const canProceed = issues.every((i) => i.severity !== "blocker");

  return {
    inputSymbol: inputSymbolResolved,
    walletInputBalance,
    walletSolBalance,
    kaminoExistingPosition,
    perSliceAmount,
    totalAmount,
    sliceCount,
    issues,
    canProceed,
  };
}
