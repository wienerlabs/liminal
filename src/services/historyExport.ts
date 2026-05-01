/**
 * LIMINAL — historyExport
 *
 * Pure-client CSV serializer for the user's execution history. Builds
 * a tax-ready spreadsheet from `analyticsStore.getHistory()` so the
 * user can hand it to their accountant or import into a portfolio
 * tool without scraping the UI.
 *
 * Two layers:
 *   - `executionsToCsv(history)` → string
 *       One row per HistoricalExecution: pair, sizes, fill price,
 *       Jupiter baseline, vs-Jupiter delta in USD + bps, Kamino
 *       yield, total value capture, duration, timestamps.
 *   - `slicesToCsv(history)` → string
 *       One row per slice across all executions: useful for users
 *       who need per-fill data (cost-basis FIFO, on-chain audit).
 *
 * `triggerDownload(filename, csv)` is a tiny convenience wrapper
 * that wires up a Blob → object URL → anchor click → revoke. Kept
 * separate so the CSV builders stay testable as pure functions.
 *
 * Field semantics:
 *   - `vs_jupiter_usd` is `summary.totalPriceImprovementUsd`. DFlow
 *     routes through Jupiter Ultra so its market baseline IS the
 *     Jupiter aggregator quote at that slot — the field name calls
 *     out the comparator explicitly for tax-context legibility.
 *   - All timestamps are ISO 8601 UTC.
 *   - All amounts are token units (not lamports / atomic units).
 */

import type {
  HistoricalExecution,
  SliceAnalytics,
} from "./analyticsStore";

// ---------------------------------------------------------------------------
// CSV escaping — RFC 4180 style. Wraps any value containing comma,
// quote, CR or LF in double quotes; doubles internal quotes.
// ---------------------------------------------------------------------------

function escapeCell(raw: string | number | boolean | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowToLine(cells: Array<string | number | boolean | null | undefined>): string {
  return cells.map(escapeCell).join(",");
}

// ---------------------------------------------------------------------------
// Per-execution rollup
// ---------------------------------------------------------------------------

const EXECUTION_COLUMNS = [
  "id",
  "created_at_iso",
  "started_at_iso",
  "completed_at_iso",
  "duration_ms",
  "input_symbol",
  "output_symbol",
  "input_mint",
  "output_mint",
  "total_input_amount",
  "total_output_amount",
  "average_fill_price",
  "jupiter_baseline_price",
  "vs_jupiter_usd",
  "vs_jupiter_bps",
  "kamino_yield_usd",
  "total_value_capture_usd",
  "completed_slices",
  "skipped_slices",
] as const;

export function executionsToCsv(history: HistoricalExecution[]): string {
  const lines: string[] = [];
  lines.push(rowToLine([...EXECUTION_COLUMNS]));
  for (const e of history) {
    lines.push(
      rowToLine([
        e.id,
        e.createdAt.toISOString(),
        e.summary.startedAt.toISOString(),
        e.summary.completedAt.toISOString(),
        e.summary.executionDurationMs,
        e.inputSymbol,
        e.outputSymbol,
        e.inputMint,
        e.outputMint,
        e.summary.totalInputAmount,
        e.summary.totalOutputAmount,
        e.summary.averageExecutionPrice,
        e.summary.baselinePrice,
        e.summary.totalPriceImprovementUsd,
        e.summary.totalPriceImprovementBps,
        e.summary.totalKaminoYieldUsd,
        e.summary.totalValueCaptureUsd,
        e.summary.completedSlices,
        e.summary.skippedSlices,
      ]),
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Per-slice rollup
// ---------------------------------------------------------------------------

const SLICE_COLUMNS = [
  "execution_id",
  "input_symbol",
  "output_symbol",
  "slice_index",
  "executed_at_iso",
  "input_amount",
  "output_amount",
  "execution_price",
  "market_price",
  "vs_jupiter_bps",
  "vs_jupiter_usd",
  "kamino_duration_ms",
  "kamino_yield_usd",
  "signature",
] as const;

export function slicesToCsv(history: HistoricalExecution[]): string {
  const lines: string[] = [];
  lines.push(rowToLine([...SLICE_COLUMNS]));
  for (const e of history) {
    for (const s of e.slices as SliceAnalytics[]) {
      lines.push(
        rowToLine([
          e.id,
          e.inputSymbol,
          e.outputSymbol,
          s.sliceIndex,
          s.executedAt.toISOString(),
          s.inputAmount,
          s.outputAmount,
          s.executionPrice,
          s.marketPrice,
          s.priceImprovementBps,
          s.priceImprovementUsd,
          s.kaminoDurationMs,
          s.kaminoYieldUsd,
          s.signature,
        ]),
      );
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Browser download trigger
// ---------------------------------------------------------------------------

export function triggerDownload(filename: string, csv: string): void {
  if (typeof document === "undefined") return;
  // BOM so Excel detects UTF-8 correctly. Numbers stays neutral with
  // or without it; sheets opens both fine.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  // Defer cleanup a tick so Safari has a chance to start the download
  // before we revoke the URL.
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 100);
}

export function defaultFilename(prefix: string): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${prefix}-${yyyy}${mm}${dd}.csv`;
}
