/**
 * LIMINAL — WalletPickerModal
 *
 * Connect Wallet butonu tıklandığında açılan seçici. 3 sağlayıcı:
 * Solflare (default), Phantom, Backpack. Hepsi aynı browser
 * extension API'sini paylaşır, sadece window scope'u farklı:
 * `window.solflare`, `window.phantom.solana`, `window.backpack`.
 *
 * Davranış:
 *   - Mount'ta yüklü extension'ları detect eder, "Detected" rozeti
 *     ile vurgular.
 *   - Wallet'a tıklanınca selectWallet(id) sonra connectWallet() —
 *     hata olursa kart altında inline mesaj gösterir, kullanıcı
 *     başka wallet seçebilir.
 *   - Esc / backdrop click ile kapanır.
 *
 * Stil: LIMINAL pastel paletinde, "siyah cam" modal hissi. Aktif
 * detected wallet pembe accent ile öne çıkar, install edilmemiş
 * olanlar download linkine yönlendirir.
 */

import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import { createPortal } from "react-dom";
import {
  connectWallet,
  SUPPORTED_WALLETS,
  type WalletId,
} from "../services/solflare";
import { WalletLogo } from "./WalletLogos";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

export type WalletPickerModalProps = {
  open: boolean;
  onClose: () => void;
};

export const WalletPickerModal: FC<WalletPickerModalProps> = ({
  open,
  onClose,
}) => {
  const [busy, setBusy] = useState<WalletId | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detect installed extensions once per open. We re-read on open so
  // a user who installs a wallet mid-session sees it without a refresh.
  const installed = useMemo(() => {
    if (!open) return new Set<WalletId>();
    return new Set(
      SUPPORTED_WALLETS.filter((w) => w.detect()).map((w) => w.id),
    );
  }, [open]);

  useEffect(() => {
    if (!open) {
      setBusy(null);
      setError(null);
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handlePick = async (id: WalletId): Promise<void> => {
    const info = SUPPORTED_WALLETS.find((w) => w.id === id);
    if (!info) return;
    if (!installed.has(id)) {
      // Not installed → open the official download page in a new tab.
      window.open(info.downloadUrl, "_blank", "noopener,noreferrer");
      return;
    }
    setError(null);
    setBusy(id);
    try {
      await connectWallet(id);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unknown connection error");
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;
  if (typeof document === "undefined") return null;

  // Portal to document.body so the modal escapes any transformed /
  // filtered ancestor (panels with `animation`/`transform` create
  // their own containing block for `position: fixed`, which would
  // pin the modal to the panel's top edge instead of the viewport).
  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose a wallet"
      style={styles.scrim}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={styles.card} onMouseDown={(e) => e.stopPropagation()}>
        <header style={styles.header}>
          <div style={styles.eyebrow}>Connect</div>
          <h2 style={styles.title}>Choose your wallet</h2>
          <p style={styles.subtitle}>
            LIMINAL signs every transaction with simulation guards.
            Solana wallets are interchangeable here.
          </p>
        </header>

        <ul style={styles.list}>
          {SUPPORTED_WALLETS.map((w) => {
            const isInstalled = installed.has(w.id);
            const isBusy = busy === w.id;
            return (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => void handlePick(w.id)}
                  disabled={busy !== null}
                  style={{
                    ...styles.row,
                    background: isInstalled
                      ? "var(--color-accent-bg-soft)"
                      : "var(--surface-card)",
                    borderColor: isInstalled
                      ? "var(--color-accent-border)"
                      : "var(--color-stroke)",
                  }}
                  className="liminal-press"
                >
                  <WalletLogo id={w.id} size={40} />
                  <div style={styles.rowMain}>
                    <div style={styles.rowLabel}>{w.label}</div>
                    <div style={styles.rowMeta}>
                      {isBusy
                        ? "Connecting…"
                        : isInstalled
                          ? "Detected · click to connect"
                          : "Not installed · click to install"}
                    </div>
                  </div>
                  <span
                    style={{
                      ...styles.rowBadge,
                      background: isInstalled
                        ? "var(--color-5)"
                        : "transparent",
                      color: isInstalled ? "#ffffff" : "var(--color-text-muted)",
                      borderColor: isInstalled
                        ? "var(--color-accent-border)"
                        : "var(--color-stroke)",
                    }}
                  >
                    {isInstalled ? "Detected" : "Install ↗"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {error && (
          <div role="alert" style={styles.error}>
            {error}
          </div>
        )}

        <footer style={styles.footer}>
          <button
            type="button"
            onClick={onClose}
            style={styles.dismissBtn}
            className="liminal-press"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

const styles: Record<string, CSSProperties> = {
  scrim: {
    position: "fixed",
    inset: 0,
    zIndex: 320,
    background: "rgba(10, 10, 10, 0.55)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    animation: "liminal-fade-in 200ms var(--ease-out, ease)",
  },
  card: {
    width: "min(440px, calc(100vw - 40px))",
    maxHeight: "calc(100vh - 40px)",
    overflowY: "auto",
    background:
      "linear-gradient(135deg, rgba(249, 178, 215, 0.10) 0%, rgba(207, 236, 243, 0.10) 50%, rgba(218, 249, 222, 0.10) 100%), var(--surface-raised)",
    backdropFilter: "blur(20px) saturate(140%)",
    WebkitBackdropFilter: "blur(20px) saturate(140%)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 18,
    boxShadow:
      "0 30px 70px rgba(0, 0, 0, 0.22), 0 10px 24px rgba(249, 178, 215, 0.18)",
    padding: 22,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    animation: "liminal-flourish-pop 280ms cubic-bezier(0.34, 1.56, 0.64, 1) backwards",
  },
  header: { display: "flex", flexDirection: "column", gap: 4 },
  eyebrow: {
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: "0.14em",
    color: "var(--color-text-muted)",
  },
  title: {
    margin: 0,
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 22,
    color: "var(--color-text)",
    letterSpacing: "-0.01em",
  },
  subtitle: {
    margin: 0,
    fontFamily: SANS,
    fontSize: 13,
    color: "var(--color-text-muted)",
    lineHeight: 1.5,
  },
  list: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  row: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid var(--color-stroke)",
    background: "var(--surface-card)",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: SANS,
    transition:
      "background var(--motion-base) var(--ease-out), border-color var(--motion-base) var(--ease-out)",
  },
  rowMain: { flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  rowLabel: {
    fontFamily: SANS,
    fontWeight: 600,
    fontSize: 15,
    color: "var(--color-text)",
  },
  rowMeta: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
  },
  rowBadge: {
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid var(--color-stroke)",
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: 700,
    flexShrink: 0,
  },
  error: {
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--color-danger)",
    background: "rgba(220, 53, 69, 0.08)",
    color: "var(--color-danger)",
    fontFamily: MONO,
    fontSize: 12,
  },
  footer: { display: "flex", justifyContent: "flex-end" },
  dismissBtn: {
    padding: "8px 16px",
    border: "1px solid var(--color-stroke)",
    background: "transparent",
    color: "var(--color-text-muted)",
    fontFamily: MONO,
    fontSize: 12,
    borderRadius: 8,
    cursor: "pointer",
  },
};

export default WalletPickerModal;
