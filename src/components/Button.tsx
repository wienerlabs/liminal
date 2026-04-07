/**
 * LIMINAL — Button
 *
 * Reusable button with hover/press micro-interactions.
 * Variants: "primary" (accent bg) and "secondary" (transparent, stroke).
 */

import { useState, type CSSProperties, type FC, type ReactNode } from "react";

export type ButtonProps = {
  children: ReactNode;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
  type?: "button" | "submit" | "reset";
};

const MONO = "var(--font-mono)";

export const Button: FC<ButtonProps> = ({
  children,
  variant = "primary",
  disabled = false,
  onClick,
  style,
  type = "button",
}) => {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const isPrimary = variant === "primary";

  const baseStyle: CSSProperties = {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 1,
    border: isPrimary ? "none" : "1px solid var(--color-stroke)",
    borderRadius: "var(--radius-md)",
    padding: "12px 20px",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
    color: isPrimary ? "var(--color-text-inverse)" : "var(--color-text)",
    background: isPrimary
      ? "linear-gradient(135deg, var(--color-5), #6366f1)"
      : "transparent",
    boxShadow: isPrimary
      ? hovered && !disabled
        ? "0 0 20px rgba(34,209,238,0.3), 0 0 60px rgba(34,209,238,0.1)"
        : undefined
      : hovered && !disabled
        ? "var(--shadow-component)"
        : "none",
    animation: isPrimary && !disabled
      ? "liminal-glow-pulse 2s ease-in-out infinite"
      : undefined,
    filter:
      hovered && !disabled ? "brightness(1.12)" : "brightness(1)",
    transform: pressed && !disabled ? "scale(0.97)" : "scale(1)",
    transition:
      "transform 100ms ease, box-shadow 150ms ease, filter 150ms ease",
    textTransform: "uppercase",
    ...style,
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        setPressed(false);
      }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={baseStyle}
    >
      {children}
    </button>
  );
};

export default Button;
