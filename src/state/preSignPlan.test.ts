import { describe, expect, it, vi } from "vitest";
import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  buildAndSignPlan,
  estimatePopups,
  MAX_AUTOPILOT_SLICES,
  type PopupEstimate,
  type SignAllFn,
  type SignOneFn,
} from "./preSignPlan";

/**
 * preSignPlan unit tests — heavy plan build is integration-tested
 * downstream, but the pure pieces (popup estimation, slice ceiling)
 * have invariants worth locking in.
 */

describe("estimatePopups", () => {
  it("autopilot mode: 2 upfront + N JIT swaps + 1 cleanup = N+3", () => {
    const e: PopupEstimate = estimatePopups(4, true);
    expect(e).toEqual({
      upfrontPopups: 2,
      jitSwapPopups: 4,
      cleanupPopups: 1,
      total: 7,
    });
  });

  it("JIT mode: 1 deposit + N batched + 1 final = N+2 popups, all JIT", () => {
    const e = estimatePopups(4, false);
    expect(e).toEqual({
      upfrontPopups: 0,
      jitSwapPopups: 6,
      cleanupPopups: 0,
      total: 6,
    });
  });

  it("scales linearly with sliceCount in both modes", () => {
    expect(estimatePopups(1, true).total).toBe(4);
    expect(estimatePopups(2, true).total).toBe(5);
    expect(estimatePopups(6, true).total).toBe(9);
    expect(estimatePopups(1, false).total).toBe(3);
    expect(estimatePopups(6, false).total).toBe(8);
  });
});

describe("MAX_AUTOPILOT_SLICES", () => {
  it("equals MAX_NONCES_PER_SETUP_TX (8) minus 2 (deposit + final) = 6", () => {
    // The constant is derived inside preSignPlan to keep the
    // dependency one-way; this test pins the resulting value so a
    // future change to the durable-nonce ceiling is caught here too.
    expect(MAX_AUTOPILOT_SLICES).toBe(6);
  });

  it("is a positive integer", () => {
    expect(Number.isInteger(MAX_AUTOPILOT_SLICES)).toBe(true);
    expect(MAX_AUTOPILOT_SLICES).toBeGreaterThan(0);
  });
});

describe("buildAndSignPlan input validation", () => {
  const dummyWallet = new PublicKey(
    "11111111111111111111111111111111",
  );
  const dummyConn = {} as Connection;
  // SignOneFn / SignAllFn are generic; vi.fn can't reproduce the
  // generic signature so we cast through a dedicated wrapper. The
  // validation tests below never invoke these — they're guards against
  // the early-exit guard regressing.
  const noopSign = (async <T extends VersionedTransaction>(tx: T) =>
    tx) as SignOneFn;
  const noopSignAll = (async <T extends VersionedTransaction>(txs: T[]) =>
    txs) as SignAllFn;
  const noopSignSpy = vi.fn(noopSign as (tx: VersionedTransaction) => Promise<VersionedTransaction>);
  const noopSignAllSpy = vi.fn(
    noopSignAll as (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>,
  );

  // The validation throws BEFORE any network call, so the dummy
  // connection / no-op signers never get exercised. These tests pin
  // the early-exit guard so a future refactor doesn't drop the bound
  // checks (which would surface as a confusing setup-tx failure
  // halfway through the autopilot flow).

  it("rejects empty slice amounts", async () => {
    await expect(
      buildAndSignPlan({
        connection: dummyConn,
        walletPublicKey: dummyWallet,
        inputMint: "x",
        totalAmount: 1,
        sliceAmounts: [],
        kaminoVaultAddress: "vaultAddrTest",
        signOne: noopSignSpy as unknown as SignOneFn,
        signAll: noopSignAllSpy as unknown as SignAllFn,
      }),
    ).rejects.toThrow(/at least 1 slice/);
  });

  it("rejects slice counts above MAX_AUTOPILOT_SLICES", async () => {
    const tooMany = new Array(MAX_AUTOPILOT_SLICES + 1).fill(1);
    await expect(
      buildAndSignPlan({
        connection: dummyConn,
        walletPublicKey: dummyWallet,
        inputMint: "x",
        totalAmount: tooMany.length,
        sliceAmounts: tooMany,
        kaminoVaultAddress: "vaultAddrTest",
        signOne: noopSignSpy as unknown as SignOneFn,
        signAll: noopSignAllSpy as unknown as SignAllFn,
      }),
    ).rejects.toThrow(/Autopilot mode supports at most/);
    // Confirms validation fires before the wallet ever sees a popup.
    expect(noopSignSpy).not.toHaveBeenCalled();
    expect(noopSignAllSpy).not.toHaveBeenCalled();
  });
});
