/**
 * LIMINAL — Disclaimer modal
 *
 * Blocking modal shown on the first wallet connect ever (per browser).
 * The user must explicitly acknowledge two things before they can
 * configure an execution:
 *
 *   1. Funds at risk — real mainnet transactions, real capital exposure.
 *   2. No warranty / hackathon software — experimental, no guarantee.
 *
 * Acceptance persists in localStorage under `liminal:disclaimer:v1`.
 * Bumping the version forces re-acceptance (breaking UX changes,
 * updated ToS text, etc.).
 *
 * Accessibility:
 *   - role=dialog, aria-modal, aria-labelledby, focus trap, body
 *     scroll lock, Escape DOES NOT close (acceptance-required).
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import Button from "./Button";
import { LiminalMark } from "./BrandLogos";

const STORAGE_KEY = "liminal:disclaimer:v1";

export function hasAcceptedDisclaimer(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Privacy mode / storage disabled — force the modal every time. This
    // is safer than auto-accepting a no-warranty clause.
    return false;
  }
}

function persistAccept(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* Storage quota — fall through; modal will re-appear on reload. */
  }
}

export type DisclaimerModalProps = {
  onAccept: () => void;
};

export const DisclaimerModal: FC<DisclaimerModalProps> = ({ onAccept }) => {
  const [ackRisk, setAckRisk] = useState(false);
  const [ackNoWarranty, setAckNoWarranty] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Focus trap + body scroll lock. Escape is explicitly NOT wired —
  // the user has to choose "Accept" or close the tab.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    modalRef.current?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    window.addEventListener("keydown", handler);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus();
    };
  }, []);

  const canAccept = ackRisk && ackNoWarranty;

  const handleAccept = (): void => {
    if (!canAccept) return;
    persistAccept();
    onAccept();
  };

  return (
    <div style={styles.overlay} role="presentation">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="liminal-disclaimer-title"
        tabIndex={-1}
        style={styles.card}
      >
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <LiminalMark size={64} style={{ margin: "0 auto" }} />
        </div>
        <h2 id="liminal-disclaimer-title" style={styles.title}>
          Before you continue
        </h2>

        <p style={styles.lead}>
          LIMINAL is experimental software. Please read and acknowledge the
          following before configuring an execution.
        </p>

        <label style={styles.check}>
          <input
            type="checkbox"
            checked={ackRisk}
            onChange={(e) => setAckRisk(e.target.checked)}
          />
          <span style={styles.checkText}>
            <strong>Funds at risk.</strong> Executions broadcast real
            transactions on Solana mainnet. Slippage, price movement, RPC
            failures, or smart-contract conditions can cause partial or
            full loss of the capital you configure for a trade.
          </span>
        </label>

        <label style={styles.check}>
          <input
            type="checkbox"
            checked={ackNoWarranty}
            onChange={(e) => setAckNoWarranty(e.target.checked)}
          />
          <span style={styles.checkText}>
            <strong>No warranty.</strong> LIMINAL is provided as-is. There
            are no guarantees of performance, availability, or outcome. You
            are solely responsible for reviewing each Solflare signing
            prompt and understanding what it will do on-chain before
            approving.
          </span>
        </label>

        <div style={styles.footer}>
          <Button
            variant="primary"
            disabled={!canAccept}
            onClick={handleAccept}
            style={{ width: "100%" }}
          >
            I understand — continue
          </Button>
          <p style={styles.finePrint}>
            By clicking continue you confirm the above. Closing this tab
            will reset acknowledgement.
          </p>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--color-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    padding: "var(--space-4)",
  },
  card: {
    background: "var(--color-2)",
    border: "1px solid var(--color-stroke-nested)",
    borderRadius: "var(--radius-lg)",
    padding: "28px 28px 20px",
    maxWidth: 480,
    width: "100%",
    boxShadow: "var(--shadow-raised)",
    fontFamily: "var(--font-sans)",
    outline: "none",
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: "var(--color-text)",
  },
  lead: {
    marginTop: 12,
    marginBottom: 20,
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--color-text-muted)",
  },
  check: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    border: "1px solid var(--color-stroke)",
    borderRadius: "var(--radius-md)",
    marginBottom: 10,
    cursor: "pointer",
    background: "var(--surface-card)",
  },
  checkText: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--color-text)",
  },
  footer: {
    marginTop: 8,
  },
  finePrint: {
    marginTop: 10,
    marginBottom: 0,
    fontSize: 11,
    lineHeight: 1.5,
    color: "var(--color-text-subtle)",
    textAlign: "center",
  },
};

export default DisclaimerModal;
