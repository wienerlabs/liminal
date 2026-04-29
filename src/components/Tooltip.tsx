/**
 * LIMINAL — Tooltip
 *
 * Wraps children, shows styled tooltip on hover/focus.
 * Position: above by default, viewport-safe via getBoundingClientRect + position:fixed.
 */

import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type FC,
  type ReactNode,
} from "react";

export type TooltipProps = {
  text: string;
  children: ReactNode;
};

export const Tooltip: FC<TooltipProps> = ({ text, children }) => {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const show = useCallback(() => {
    if (!wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPos({
      top: rect.top - 6,
      left: rect.left + rect.width / 2,
    });
    setVisible(true);
  }, []);

  const hide = useCallback(() => {
    setVisible(false);
  }, []);

  return (
    <div
      ref={wrapRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      style={{ display: "inline-flex" }}
    >
      {children}
      {visible && pos && (
        <div
          role="tooltip"
          style={{
            ...styles.tooltip,
            top: pos.top,
            left: pos.left,
            transform: "translate(-50%, -100%)",
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  tooltip: {
    position: "fixed",
    zIndex: 10000,
    background: "var(--color-3)",
    border: "1px solid var(--color-stroke-nested)",
    boxShadow: "var(--shadow-raised)",
    borderRadius: "var(--radius-sm)",
    fontFamily: "var(--font-sans)",
    fontSize: 16,
    color: "var(--color-text)",
    maxWidth: 220,
    padding: "6px 10px",
    lineHeight: 1.4,
    pointerEvents: "none",
    whiteSpace: "normal",
  },
};

export default Tooltip;
