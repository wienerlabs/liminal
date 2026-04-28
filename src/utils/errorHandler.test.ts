import { describe, expect, it } from "vitest";
import { parseError } from "./errorHandler";
import { ErrorCode } from "../state/executionMachine";

/**
 * errorHandler.parseError is the single regex-based classifier every
 * catch block in the state machine + services routes through. These
 * smoke tests lock in the stable mapping of well-known errors to
 * ErrorCode + retryable flags so a refactor can't silently downgrade
 * classification.
 */

describe("parseError", () => {
  it("classifies 'User rejected' as WALLET_REJECTED", () => {
    const err = parseError(
      new Error("User rejected the request"),
      0,
      "kamino-deposit",
    );
    expect(err.code).toBe(ErrorCode.WALLET_REJECTED);
    // WALLET_REJECTED may or may not be retryable depending on variant,
    // but sliceIndex + code mapping are the stable contract.
    expect(err.sliceIndex).toBe(0);
  });

  it("routes 'timed out' + kamino-withdraw phase to KAMINO_WITHDRAW_FAILED", () => {
    const err = parseError(
      new Error("Kamino withdraw query timed out (60000ms)."),
      1,
      "kamino-withdraw",
    );
    // parseError prefers phase-specific classification over generic
    // timeout — the caller asked for the Kamino flow, so surface it.
    expect(err.code).toBe(ErrorCode.KAMINO_WITHDRAW_FAILED);
    expect(err.sliceIndex).toBe(1);
  });

  it("classifies 'transaction was not confirmed in Ns' as TRANSACTION_TIMEOUT", () => {
    const err = parseError(
      new Error("Transaction was not confirmed in 60 seconds"),
      null,
      undefined,
    );
    expect(err.code).toBe(ErrorCode.TRANSACTION_TIMEOUT);
    expect(err.retryable).toBe(true);
  });

  it("classifies 'blockhash not found' as TRANSACTION_TIMEOUT retryable", () => {
    const err = parseError(
      new Error("Blockhash not found"),
      null,
      undefined,
    );
    expect(err.code).toBe(ErrorCode.TRANSACTION_TIMEOUT);
    expect(err.retryable).toBe(true);
  });

  it("classifies Kamino insufficient liquidity (non-retryable, funds safe)", () => {
    const err = parseError(
      new Error("Insufficient liquidity available in the Kamino vault"),
      1,
      "kamino-withdraw",
    );
    expect(err.code).toBe(ErrorCode.KAMINO_INSUFFICIENT_LIQUIDITY);
    expect(err.retryable).toBe(false);
  });

  it("classifies Quote expired as DFLOW_QUOTE_EXPIRED (retryable)", () => {
    const err = parseError(
      new Error("Quote expired, fetching a new quote."),
      2,
      "dflow-quote",
    );
    expect(err.code).toBe(ErrorCode.DFLOW_QUOTE_EXPIRED);
    expect(err.retryable).toBe(true);
  });

  it("classifies slippage exceeded message as SLIPPAGE_EXCEEDED", () => {
    const err = parseError(
      new Error("Current slippage %1.20, configured limit %0.50. Execution skipped."),
      0,
      "dflow-quote",
    );
    expect(err.code).toBe(ErrorCode.SLIPPAGE_EXCEEDED);
  });

  it("falls back to UNKNOWN for unclassified errors", () => {
    const err = parseError(
      new Error("Some totally novel failure 12345"),
      null,
      undefined,
    );
    expect(err.code).toBe(ErrorCode.UNKNOWN);
  });

  it("carries a timestamp on every classification", () => {
    const err = parseError(new Error("x"), null, undefined);
    expect(err.timestamp).toBeInstanceOf(Date);
  });

  // Bug BBB: insufficient SOL for fee — multiple Solana RPC phrasings
  // all map to a single actionable, non-retryable error.
  it("classifies 'insufficient lamports' as a non-retryable top-up prompt", () => {
    const err = parseError(
      new Error("Transfer: insufficient lamports 100, need 5000"),
      0,
      "kamino-deposit",
    );
    expect(err.code).toBe(ErrorCode.UNKNOWN);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/Top up your wallet|0\.05 SOL/i);
  });

  it("classifies 'InsufficientFundsForFee' (RPC error variant)", () => {
    const err = parseError(
      new Error(
        '{"err":{"InstructionError":[0,"InsufficientFundsForFee"]}}',
      ),
      null,
      "dflow-swap",
    );
    expect(err.code).toBe(ErrorCode.UNKNOWN);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/Top up/i);
  });

  it("classifies 'Attempt to debit an account' as insufficient SOL", () => {
    const err = parseError(
      new Error(
        "Attempt to debit an account but found no record of a prior credit.",
      ),
      0,
      "kamino-withdraw",
    );
    expect(err.code).toBe(ErrorCode.UNKNOWN);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/Top up/i);
  });
});
