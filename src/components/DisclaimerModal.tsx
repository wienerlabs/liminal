/**
 * LIMINAL — Disclaimer modal
 *
 * Blocking modal shown on the first wallet connect ever (per browser).
 * The user must explicitly acknowledge FOUR things before they can
 * configure an execution:
 *
 *   1. Funds at risk — real mainnet transactions, real capital exposure.
 *   2. Not audited — no formal smart-contract / code audit completed,
 *      partner integrations carry their own protocol risk.
 *   3. Don't ape — start with amounts you can afford to lose; demo /
 *      test slices first, scale up only after personal verification.
 *   4. No warranty — provided as-is, hackathon-stage software, no
 *      guarantee of performance, availability, or outcome.
 *
 * Acceptance persists in localStorage under `liminal:disclaimer:v2`.
 * The v2 bump invalidates v1 acceptances so existing users see the
 * expanded (audit + ape-warning) wording on next connect.
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

// Bumped from v1 → v2 when the audit + ape-warning acknowledgements were
// added. Users who accepted the shorter v1 disclaimer will see the
// expanded modal once on their next connect.
const STORAGE_KEY = "liminal:disclaimer:v2";

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
  const [ackNotAudited, setAckNotAudited] = useState(false);
  const [ackDontApe, setAckDontApe] = useState(false);
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

  const canAccept = ackRisk && ackNotAudited && ackDontApe && ackNoWarranty;

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
          LIMINAL is unaudited, hackathon-stage software running on Solana
          mainnet. Read and acknowledge every line below before you
          connect — there is no partial entry.
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
            failures, MEV, oracle staleness, or bugs in this app or any
            of its integrations (Kamino, Jupiter Ultra/DFlow, Solflare,
            QuickNode) can cause partial or total loss of the capital you
            configure for a trade. Loss is a real outcome, not a corner
            case.
          </span>
        </label>

        <label style={styles.check}>
          <input
            type="checkbox"
            checked={ackNotAudited}
            onChange={(e) => setAckNotAudited(e.target.checked)}
          />
          <span style={styles.checkText}>
            <strong>Not audited.</strong> The LIMINAL codebase has not
            gone through a formal third-party security audit. The
            partner protocols it composes (Kamino, Jupiter Ultra/DFlow,
            Solflare, QuickNode, Pyth) carry their own independent risk —
            their audit status, uptime, and economic guarantees are not
            controlled by LIMINAL. A failure in any partner can affect
            funds routed through this app.
          </span>
        </label>

        <label style={styles.check}>
          <input
            type="checkbox"
            checked={ackDontApe}
            onChange={(e) => setAckDontApe(e.target.checked)}
          />
          <span style={styles.checkText}>
            <strong>Don't ape.</strong> Start small. Run a tiny test
            slice (a few dollars) to verify the full flow on your own
            wallet on chain. Only scale up after you have personally
            seen the deposit, the slice swaps, and the final withdraw
            settle. Never put in more than you can afford to lose
            entirely. Demo presets are demo presets — not production
            settings.
          </span>
        </label>

        <label style={styles.check}>
          <input
            type="checkbox"
            checked={ackNoWarranty}
            onChange={(e) => setAckNoWarranty(e.target.checked)}
          />
          <span style={styles.checkText}>
            <strong>No warranty. Your responsibility.</strong> LIMINAL is
            provided as-is with no guarantee of performance, availability,
            or outcome. You are solely responsible for reading every
            Solflare signing prompt and confirming what it does on chain
            before approving. No author, contributor, or partner is
            liable for losses incurred while using this software.
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
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.01em",
    color: "var(--color-text)",
  },
  lead: {
    marginTop: 12,
    marginBottom: 20,
    fontSize: 16,
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
    fontSize: 15,
    lineHeight: 1.5,
    color: "var(--color-text)",
  },
  footer: {
    marginTop: 8,
  },
  finePrint: {
    marginTop: 10,
    marginBottom: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--color-text-subtle)",
    textAlign: "center",
  },
};

export default DisclaimerModal;
