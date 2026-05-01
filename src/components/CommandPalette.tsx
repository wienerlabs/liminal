/**
 * LIMINAL — CommandPalette
 *
 * ⌘K / Ctrl-K global launcher inspired by Linear, Raycast, Vercel. Two
 * modes:
 *   1. Action mode (default): fuzzy-match across a static command list
 *      (toggle theme, jump to wallet/execute/analytics on mobile, copy
 *      address, disconnect, etc.).
 *   2. Token mode: when the query is empty or starts with a letter, we
 *      also rank the user's wallet tokens. Selecting a token routes to
 *      the configurable target — "Set From = USDC" / "Set To = SOL".
 *
 * Architecture:
 *   - Module-level visibility store + `useCommandPalette()` hook so any
 *     component can call `open()` (e.g. a Cmd-K hint button).
 *   - Global keyboard listener on `mod+K` toggles the palette. Esc
 *     closes. Arrow keys move selection. Enter executes.
 *   - Pure presentational — the consumer (App.tsx) injects the actions
 *     and tokens it has access to.
 *
 * Why no fuzzy matcher dep: the action list is < 20 items and the token
 * list is < 50. A simple substring + word-prefix scorer is plenty and
 * keeps bundle size flat.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type FC,
  type ReactNode,
} from "react";
import type { TokenInfo } from "../services/tokenRegistry";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

// ---------------------------------------------------------------------------
// Visibility store
// ---------------------------------------------------------------------------

let isOpen = false;
const subs = new Set<() => void>();
function notify(): void {
  for (const fn of subs) fn();
}
function setOpen(next: boolean): void {
  if (isOpen === next) return;
  isOpen = next;
  notify();
}
export function openPalette(): void {
  setOpen(true);
}
export function closePalette(): void {
  setOpen(false);
}
export function togglePalette(): void {
  setOpen(!isOpen);
}

export function useCommandPalette(): {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
} {
  const open = useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => isOpen,
    () => false,
  );
  return {
    open,
    show: openPalette,
    hide: closePalette,
    toggle: togglePalette,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CommandAction = {
  /** Stable id, used for React key and to dedup. */
  id: string;
  /** Visible label. */
  label: string;
  /** Optional secondary line (kbd hint, current state, etc.). */
  hint?: string;
  /** Optional category — grouped in the rendered list. */
  category?: string;
  /** Optional inline icon (16×16 svg or emoji). */
  icon?: ReactNode;
  /** Search keywords beyond the label. */
  keywords?: string[];
  /** Action — receives no args; close-on-execute is automatic. */
  run: () => void;
};

export type CommandToken = {
  mint: string;
  symbol: string;
  balance: number;
};

export type CommandPaletteProps = {
  actions: CommandAction[];
  tokens?: CommandToken[];
  lookup?: (mint: string) => TokenInfo | null;
  /** When a token is picked, what target slot does the consumer want
   * to fill? Returns one or two CommandActions per token. */
  onTokenSelect?: (token: CommandToken) => CommandAction[];
};

// ---------------------------------------------------------------------------
// Scorer
// ---------------------------------------------------------------------------

function score(haystack: string, needle: string): number {
  if (!needle) return 1;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return 1000;
  if (h.startsWith(n)) return 500 - (h.length - n.length);
  const idx = h.indexOf(n);
  if (idx >= 0) return 200 - idx;
  // Subsequence (fuzzy) — every char of n appears in order in h.
  let i = 0;
  for (let j = 0; j < h.length && i < n.length; j++) {
    if (h[j] === n[i]) i++;
  }
  return i === n.length ? 50 - (h.length - n.length) : 0;
}

function scoreAction(a: CommandAction, query: string): number {
  if (!query) return 1;
  const main = score(a.label, query);
  if (main > 0) return main;
  if (a.keywords) {
    for (const k of a.keywords) {
      const s = score(k, query);
      if (s > 0) return s * 0.7;
    }
  }
  if (a.category) {
    const s = score(a.category, query);
    if (s > 0) return s * 0.5;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CommandPalette: FC<CommandPaletteProps> = ({
  actions,
  tokens = [],
  lookup,
  onTokenSelect,
}) => {
  const { open, hide } = useCommandPalette();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Reset state on each open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      // focus after the modal mounts so the autoFocus prop is reliable
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Build merged result list (actions + token-derived actions). The
  // expansion happens on every keystroke; cheap because n is small.
  const items: CommandAction[] = useMemo(() => {
    const tokenItems: CommandAction[] = onTokenSelect
      ? tokens.flatMap((t) => onTokenSelect(t))
      : [];
    return [...actions, ...tokenItems];
  }, [actions, tokens, onTokenSelect]);

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // No query: just show all items in original order, capped.
      return items.slice(0, 20);
    }
    const scored = items
      .map((a) => ({ a, s: scoreAction(a, query) }))
      .filter((x) => x.s > 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, 20)
      .map((x) => x.a);
    return scored;
  }, [items, query]);

  // Clamp selection when filter changes.
  useEffect(() => {
    setSelected((s) => Math.max(0, Math.min(s, filtered.length - 1)));
  }, [filtered]);

  // Scroll selected option into view.
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLLIElement>(
      `li[data-index="${selected}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // Keyboard inside the palette.
  const onKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        hide();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(filtered.length - 1, s + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selected];
        if (item) {
          item.run();
          hide();
        }
      }
    },
    [filtered, selected, hide],
  );

  if (!open) return null;

  // Group by category for visual structure.
  const grouped = new Map<string, CommandAction[]>();
  for (const a of filtered) {
    const cat = a.category ?? "Actions";
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(a);
  }

  let runningIndex = 0;
  const sections: { cat: string; items: { item: CommandAction; idx: number }[] }[] = [];
  for (const [cat, list] of grouped) {
    const items = list.map((item) => ({ item, idx: runningIndex++ }));
    sections.push({ cat, items });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      style={styles.overlay}
      onMouseDown={(e) => {
        // Backdrop click closes (only when clicking the overlay itself,
        // not bubbled clicks from inside the panel).
        if (e.target === e.currentTarget) hide();
      }}
      onKeyDown={onKey}
    >
      <div style={styles.panel}>
        <div style={styles.searchWrap}>
          <span style={styles.searchIcon} aria-hidden="true">
            ⌘
          </span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Type a command, search a token…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={styles.searchInput}
            aria-label="Command palette search"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd style={styles.escHint} aria-hidden="true">
            esc
          </kbd>
        </div>
        <ul ref={listRef} style={styles.list} role="listbox">
          {filtered.length === 0 ? (
            <li style={styles.empty}>No matches</li>
          ) : (
            sections.map(({ cat, items }) => (
              <div key={cat}>
                <div style={styles.sectionHeader}>{cat}</div>
                {items.map(({ item, idx }) => (
                  <li
                    key={item.id}
                    data-index={idx}
                    role="option"
                    aria-selected={idx === selected}
                    onMouseEnter={() => setSelected(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      item.run();
                      hide();
                    }}
                    style={{
                      ...styles.row,
                      background:
                        idx === selected
                          ? "var(--color-accent-bg-soft)"
                          : "transparent",
                    }}
                  >
                    {item.icon && (
                      <span style={styles.rowIcon} aria-hidden="true">
                        {item.icon}
                      </span>
                    )}
                    <span style={styles.rowLabel}>{item.label}</span>
                    {item.hint && (
                      <span style={styles.rowHint}>{item.hint}</span>
                    )}
                  </li>
                ))}
              </div>
            ))
          )}
        </ul>
        <footer style={styles.footer}>
          <span style={styles.footerKbd}>↑↓ navigate</span>
          <span style={styles.footerKbd}>↵ select</span>
          <span style={styles.footerKbd}>esc close</span>
        </footer>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Hotkey installer — call once at the App root. Listens for
// mod+K and toggles the palette.
// ---------------------------------------------------------------------------

export function useCommandPaletteHotkey(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      const isModK =
        (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (isModK) {
        e.preventDefault();
        togglePalette();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--color-overlay, rgba(0, 0, 0, 0.5))",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "center",
    paddingTop: "10vh",
    zIndex: 200,
    animation: "liminal-scale-in 160ms var(--ease-out, ease)",
  },
  panel: {
    width: "min(640px, calc(100vw - 32px))",
    maxHeight: "70vh",
    background: "var(--surface-raised)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 14,
    boxShadow:
      "0 24px 60px rgba(0, 0, 0, 0.18), 0 8px 24px rgba(0, 0, 0, 0.08)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "14px 16px",
    borderBottom: "1px solid var(--color-stroke)",
  },
  searchIcon: {
    fontFamily: MONO,
    fontSize: 14,
    color: "var(--color-text-muted)",
    fontWeight: 700,
  },
  searchInput: {
    flex: 1,
    border: "none",
    outline: "none",
    background: "transparent",
    fontFamily: SANS,
    fontSize: 16,
    color: "var(--color-text)",
  },
  escHint: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 4,
    padding: "2px 6px",
  },
  list: {
    flex: 1,
    listStyle: "none",
    margin: 0,
    padding: "8px 0",
    overflowY: "auto",
  },
  sectionHeader: {
    padding: "8px 16px 4px",
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: "var(--color-text-muted)",
    textTransform: "uppercase",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 16px",
    cursor: "pointer",
    transition: "background var(--motion-base) var(--ease-out)",
  },
  rowIcon: {
    width: 20,
    height: 20,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    color: "var(--color-text-muted)",
  },
  rowLabel: {
    flex: 1,
    fontFamily: SANS,
    fontSize: 14,
    color: "var(--color-text)",
  },
  rowHint: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
    fontVariantNumeric: "tabular-nums",
  },
  empty: {
    padding: "24px 16px",
    textAlign: "center",
    fontFamily: SANS,
    fontSize: 13,
    color: "var(--color-text-muted)",
  },
  footer: {
    display: "flex",
    gap: 14,
    padding: "10px 16px",
    borderTop: "1px solid var(--color-stroke)",
    background: "var(--surface-card, transparent)",
  },
  footerKbd: {
    fontFamily: MONO,
    fontSize: 11,
    color: "var(--color-text-muted)",
  },
};

// Helper for consumers — reuse the same lookup for token logo icons.
export function makeTokenLogoIcon(
  token: CommandToken,
  lookup?: (mint: string) => TokenInfo | null,
): ReactNode {
  const info = lookup?.(token.mint) ?? null;
  const url = info?.logoURI ?? null;
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={18}
        height={18}
        style={{ borderRadius: "50%" }}
        aria-hidden="true"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: 18,
        height: 18,
        borderRadius: "50%",
        background: "var(--color-5)",
        color: "#fff",
        fontFamily: MONO,
        fontSize: 10,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {token.symbol.slice(0, 1)}
    </span>
  );
}

export default CommandPalette;
