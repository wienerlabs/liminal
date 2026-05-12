/**
 * LIMINAL — Pre-execution confirmation modal
 *
 * Surfaces the `PreCheckResult` from `services/preCheck.ts` so the
 * user can see exactly what's about to happen BEFORE depositEffect
 * starts asking for Solflare signatures.
 *
 * Content:
 *   - Per-slice withdraw size (the number that, if wrong, produces
 *     the dreaded `InstructionError[*, {"Custom":1}]` on slice 1).
 *   - Wallet input-token balance vs. configured totalAmount.
 *   - SOL gas budget vs. recommended floor.
 *   - Existing Kamino position (if any) — flagged as a warning so the
 *     user knows the final withdraw will drain it too.
 *
 * UX:
 *   - "Start execution" is disabled until every blocker is resolved.
 *   - "Cancel" closes the modal and leaves the config intact so the
 *     user can edit the amount without redoing the whole form.
 *   - Escape closes (cancel) — unlike DisclaimerModal which is
 *     acceptance-required.
 */

import {
  useEffect,
  useRef,
  type CSSProperties,
  type FC,
} from "react";
import Button from "./Button";
import type { PreCheckResult, PreCheckIssue } from "../services/preCheck";

export type PreCheckBannerProps = {
  result: PreCheckResult;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(10, 10, 10, 0.55)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    padding: 24,
  },
  card: {
    background: "var(--paper, #ffffff)",
    border: "1px solid var(--stroke, rgba(26,26,26,0.12))",
    borderRadius: 16,
    maxWidth: 520,
    width: "100%",
    maxHeight: "90vh",
    overflowY: "auto",
    padding: 28,
    boxShadow: "0 24px 60px -10px rgba(0,0,0,0.25)",
    fontFamily: "var(--font-mono, 'ABC Favorit Mono', ui-monospace, monospace)",
    color: "var(--ink, #0a0a0a)",
  },
  eyebrow: {
    fontSize: 11,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--muted, #5b6470)",
    marginBottom: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    marginBottom: 16,
    lineHeight: 1.2,
  },
  rowGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    margin: "18px 0",
    padding: "14px 16px",
    background: "var(--color-1, #f6ffdc)",
    borderRadius: 10,
    border: "1px solid var(--stroke-soft, rgba(26,26,26,0.06))",
  },
  row: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 12,
    fontSize: 14,
  },
  rowLabel: {
    color: "var(--muted, #5b6470)",
  },
  rowValue: {
    fontWeight: 600,
    fontVariantNumeric: "tabular-nums",
  },
  rowValueDim: {
    fontWeight: 500,
    color: "var(--subtle, #8e9aa6)",
    fontVariantNumeric: "tabular-nums",
  },
  issueList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    margin: "16px 0",
  },
  issueRow: {
    display: "flex",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 8,
    fontSize: 13,
    lineHeight: 1.4,
    alignItems: "flex-start",
  },
  issueRowBlocker: {
    background: "rgba(239, 68, 68, 0.08)",
    border: "1px solid rgba(239, 68, 68, 0.25)",
    color: "#7a1f1f",
  },
  issueRowWarning: {
    background: "rgba(245, 158, 11, 0.08)",
    border: "1px solid rgba(245, 158, 11, 0.25)",
    color: "#7a4d09",
  },
  issueIcon: {
    flexShrink: 0,
    fontWeight: 700,
    fontSize: 14,
    lineHeight: "20px",
  },
  buttons: {
    display: "flex",
    gap: 12,
    marginTop: 24,
    justifyContent: "flex-end",
  },
};

function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toFixed(6);
  if (n < 100) return n.toFixed(4);
  return n.toFixed(2);
}

const IssueLine: FC<{ issue: PreCheckIssue }> = ({ issue }) => {
  const isBlocker = issue.severity === "blocker";
  const rowStyle: CSSProperties = {
    ...styles.issueRow,
    ...(isBlocker ? styles.issueRowBlocker : styles.issueRowWarning),
  };
  return (
    <div style={rowStyle} role={isBlocker ? "alert" : "status"}>
      <span style={styles.issueIcon} aria-hidden="true">
        {isBlocker ? "✕" : "!"}
      </span>
      <span>{issue.message}</span>
    </div>
  );
};

export const PreCheckBanner: FC<PreCheckBannerProps> = ({
  result,
  loading = false,
  onConfirm,
  onCancel,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape-to-cancel. Body scroll lock so the page behind
  // doesn't jump while the modal is open.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab" && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus();
    };
  }, [onCancel]);

  const lastSliceAmount =
    result.sliceCount > 1
      ? result.totalAmount - result.perSliceAmount * (result.sliceCount - 1)
      : result.totalAmount;

  return (
    <div
      style={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      aria-modal="true"
      role="dialog"
      aria-labelledby="precheck-title"
    >
      <div
        ref={cardRef}
        style={styles.card}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={styles.eyebrow}>Pre-flight check</div>
        <h2 id="precheck-title" style={styles.title}>
          Confirm execution plan
        </h2>

        <div style={styles.rowGroup} aria-label="Plan summary">
          <div style={styles.row}>
            <span style={styles.rowLabel}>Total deposit</span>
            <span style={styles.rowValue}>
              {formatAmount(result.totalAmount)} {result.inputSymbol}
            </span>
          </div>
          <div style={styles.row}>
            <span style={styles.rowLabel}>
              Per slice × {result.sliceCount - 1}
            </span>
            <span style={styles.rowValue}>
              {formatAmount(result.perSliceAmount)} {result.inputSymbol}
            </span>
          </div>
          {result.sliceCount > 1 && (
            <div style={styles.row}>
              <span style={styles.rowLabel}>Last slice (residual)</span>
              <span style={styles.rowValueDim}>
                {formatAmount(lastSliceAmount)} {result.inputSymbol}
              </span>
            </div>
          )}
        </div>

        <div style={styles.rowGroup} aria-label="Wallet balances">
          <div style={styles.row}>
            <span style={styles.rowLabel}>
              Wallet {result.inputSymbol} balance
            </span>
            <span style={styles.rowValue}>
              {formatAmount(result.walletInputBalance)} {result.inputSymbol}
            </span>
          </div>
          <div style={styles.row}>
            <span style={styles.rowLabel}>Wallet SOL (gas)</span>
            <span style={styles.rowValue}>
              {formatAmount(result.walletSolBalance)} SOL
            </span>
          </div>
          {result.kaminoExistingPosition > 0 && (
            <div style={styles.row}>
              <span style={styles.rowLabel}>Existing Kamino position</span>
              <span style={styles.rowValueDim}>
                {formatAmount(result.kaminoExistingPosition)}{" "}
                {result.inputSymbol}
              </span>
            </div>
          )}
        </div>

        {result.issues.length > 0 && (
          <div style={styles.issueList} aria-label="Pre-flight issues">
            {result.issues.map((issue, i) => (
              <IssueLine key={`${issue.code}-${i}`} issue={issue} />
            ))}
          </div>
        )}

        <div style={styles.buttons}>
          <Button onClick={onCancel} variant="secondary" disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            variant="primary"
            disabled={!result.canProceed || loading}
            aria-label={
              result.canProceed
                ? "Confirm and start execution"
                : "Cannot start — resolve blockers first"
            }
          >
            {loading ? "Starting…" : "Start execution"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default PreCheckBanner;
