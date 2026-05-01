/**
 * LIMINAL — usePairQueueRunner
 *
 * Drives the sequential pair queue. Mirrors useDcaRunner's pattern:
 *   - 30s tick (or shorter — we want to fire the next step quickly
 *     after the previous DONE)
 *   - Pulls `getNextStep()` and fires through the execution machine
 *     when the machine is IDLE/CONFIGURED
 *   - Awaits `selectOptimalVault` per step (different input mints
 *     mean different vaults)
 *   - On state.status === DONE, captures the run's value capture USD,
 *     calls `markStepDone(id, gainUsd)`, and the next tick picks up
 *     the next step
 *   - On ERROR, calls markStepError; if onError === "stop" the
 *     remaining pending steps are auto-skipped so the runner stops
 *
 * Re-entrancy lock prevents two ticks from firing the same step.
 */

import { useEffect, useRef } from "react";
import {
  getActiveQueue,
  getNextStep,
  markStepActive,
  markStepDone,
  markStepError,
  skipStep,
} from "../services/pairQueue";
import { selectOptimalVault } from "../services/kamino";
import type { ExecutionState } from "../state/executionMachine";
import { ExecutionStatus } from "../state/executionMachine";
import type { UseExecutionMachineResult } from "./useExecutionMachine";

const TICK_INTERVAL_MS = 15_000; // tighter than DCA — sequential should feel snappy

export function usePairQueueRunner(opts: {
  walletConnected: boolean;
  machine: UseExecutionMachineResult;
  state: ExecutionState;
}): void {
  const { walletConnected, machine, state } = opts;
  const firingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Track the step currently in flight so we can mark it done /
  // error when the machine state transitions.
  const activeStepIdRef = useRef<string | null>(null);

  // Watch for state.status transitions on the active step.
  useEffect(() => {
    const activeId = activeStepIdRef.current;
    if (!activeId) return;
    if (state.status === ExecutionStatus.DONE) {
      markStepDone(activeId, state.totalPriceImprovementUsd);
      activeStepIdRef.current = null;
    } else if (state.status === ExecutionStatus.ERROR) {
      markStepError(activeId, state.error?.message ?? "unknown");
      activeStepIdRef.current = null;
      // Stop-on-error: skip all remaining pending steps.
      const queue = getActiveQueue();
      if (queue?.onError === "stop") {
        for (const s of queue.steps) {
          if (s.status === "pending") skipStep(s.id);
        }
      }
    }
  }, [state.status, state.totalPriceImprovementUsd, state.error]);

  useEffect(() => {
    if (!walletConnected) return;

    const tick = async (): Promise<void> => {
      if (firingRef.current) return;
      // If a step is already in-flight (machine non-idle), wait.
      const status = stateRef.current.status;
      if (
        status !== ExecutionStatus.IDLE &&
        status !== ExecutionStatus.CONFIGURED &&
        status !== ExecutionStatus.DONE
      ) {
        return;
      }

      // Don't fire the next step if we're still showing DONE for the
      // previous one — the user needs a moment to see the summary
      // card. They'll click "START NEW EXECUTION" or wait for the
      // next tick.
      if (status === ExecutionStatus.DONE) return;

      const next = getNextStep();
      if (!next || next.status !== "pending") return;

      firingRef.current = true;
      try {
        const vault = await selectOptimalVault(next.inputMint);
        if (!vault) {
          // No vault for this token — skip this step and move on so
          // the queue doesn't stall.
          skipStep(next.id);
          return;
        }
        markStepActive(next.id);
        activeStepIdRef.current = next.id;
        machine.configure({
          inputMint: next.inputMint,
          outputMint: next.outputMint,
          totalAmount: next.amount,
          sliceCount: next.sliceCount,
          windowDurationMs: next.windowDurationMs,
          slippageBps: next.slippageBps,
          preSignEnabled: next.preSignEnabled,
          kaminoVaultAddress: vault.marketAddress,
        });
        machine.start();
      } catch (err) {
        markStepError(next.id, err instanceof Error ? err.message : String(err));
        activeStepIdRef.current = null;
      } finally {
        firingRef.current = false;
      }
    };

    void tick();
    const id = setInterval(() => void tick(), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [walletConnected, machine]);
}
