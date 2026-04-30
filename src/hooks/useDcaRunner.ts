/**
 * LIMINAL — useDcaRunner hook
 *
 * Drives the DCA scheduler from the App root. Ticks every 30s; when a
 * schedule's `nextFireAt` is due AND the wallet is connected AND the
 * execution machine is IDLE/CONFIGURED, configures + starts a run
 * using the schedule's plan, then calls markRan to advance the cadence
 * (or cancels the schedule when totalCycles is reached).
 *
 * Critical details
 *   - We never fire while another execution is in flight. The runner
 *     defers the schedule by one cadence interval if the machine is
 *     busy, so the user's manual run isn't preempted.
 *   - The wallet must be connected. If the user disconnects, due
 *     schedules just sit there until reconnect; runner doesn't auto-
 *     cancel them.
 *   - selectOptimalVault is awaited at fire time. If no vault is
 *     resolvable (no liquidity for that token in Kamino main market),
 *     we defer 5 minutes and try again — usually a transient state.
 *
 * App.tsx mounts this once near the top of the tree; that's enough.
 * Multiple instances would race but the markRan() advance is
 * idempotent so the worst case is a single double-fire on restart.
 */

import { useEffect, useRef } from "react";
import {
  deferSchedule,
  getDueSchedule,
  markRan,
} from "../services/dcaScheduler";
import { selectOptimalVault } from "../services/kamino";
import type { ExecutionState } from "../state/executionMachine";
import { ExecutionStatus } from "../state/executionMachine";
import type { UseExecutionMachineResult } from "./useExecutionMachine";

// 30s tick — fast enough to feel responsive when a schedule is about
// to fire, slow enough to not burn CPU on idle tabs.
const TICK_INTERVAL_MS = 30_000;

export function useDcaRunner(opts: {
  walletConnected: boolean;
  walletAddress: string | null;
  machine: UseExecutionMachineResult;
  state: ExecutionState;
}): void {
  const { walletConnected, machine, state } = opts;
  // Lock to prevent re-entrancy: while a fire is in progress (await
  // selectOptimalVault, configure, start) we don't want a second
  // tick to start another.
  const firingRef = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!walletConnected) return;

    const tick = async (): Promise<void> => {
      if (firingRef.current) return;
      const due = getDueSchedule();
      if (!due) return;

      const status = stateRef.current.status;
      const machineFree =
        status === ExecutionStatus.IDLE ||
        status === ExecutionStatus.CONFIGURED;
      if (!machineFree) {
        // User has a manual run in flight; push the DCA schedule out
        // by one cadence interval so we don't preempt them.
        deferSchedule(due.id, due.cadence.intervalMs);
        return;
      }

      firingRef.current = true;
      try {
        const vault = await selectOptimalVault(due.plan.inputMint);
        if (!vault) {
          // Try again in 5 minutes — Kamino vault list is usually
          // transient when this happens.
          deferSchedule(due.id, 5 * 60_000);
          return;
        }

        const totalAmount = due.plan.amountPerCycle;
        machine.configure({
          inputMint: due.plan.inputMint,
          outputMint: due.plan.outputMint,
          totalAmount,
          sliceCount: due.plan.sliceCount,
          windowDurationMs: due.plan.windowDurationMs,
          slippageBps: due.plan.slippageBps,
          preSignEnabled: due.plan.preSignEnabled,
          kaminoVaultAddress: vault.marketAddress,
        });
        machine.start();
        markRan(due.id);
      } catch (err) {
        // Unrecoverable error — push the schedule so we don't
        // burn through cycles on a broken state. User can inspect
        // the schedule + manually retry / cancel.
        console.warn(
          `[LIMINAL/DCA] runner error: ${err instanceof Error ? err.message : String(err)}`,
        );
        deferSchedule(due.id, 10 * 60_000);
      } finally {
        firingRef.current = false;
      }
    };

    // Fire once on mount in case a schedule is already due, then start
    // the recurring tick.
    void tick();
    const id = setInterval(() => void tick(), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [walletConnected, machine]);
}
