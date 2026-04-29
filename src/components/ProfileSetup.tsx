/**
 * LIMINAL — ProfileSetup modal
 *
 * First-connect onboarding experience. The user has just signed in
 * with their Solflare wallet; the app needs a friendly identity
 * before letting them into the terminal. Two pieces:
 *
 *   1. Avatar picker — large selected avatar centred in a halo'd
 *      stage; a thumbnail strip below for the 4 LIMINAL-themed
 *      designs (`ProfileAvatar.tsx`).
 *   2. Username input — 3-20 chars, validated by `profileStore.
 *      validateUsername` so the rule lives in one place.
 *
 * Adapted from the kokonutui Avatar Picker pattern. The original
 * leans on Framer Motion + Tailwind + shadcn primitives; we keep
 * the same visual rhythm with pure CSS animations + inline styles
 * that match the rest of LIMINAL.
 *
 * Renders as a centred modal overlay (similar to DisclaimerModal).
 * Esc closes only when `dismissable` is true — the first-time flow
 * is mandatory but the "edit profile" reuse is dismissable.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FC,
} from "react";
import {
  PROFILE_USERNAME_LIMITS,
  validateUsername,
  type ProfileRecord,
} from "../services/profileStore";
import { AVATARS, ProfileAvatar, getAvatarById } from "./ProfileAvatar";

const MONO = "var(--font-mono)";
const SANS = "var(--font-sans)";

export type ProfileSetupProps = {
  /** Solana address — required, used to scope the saved record. */
  address: string;
  /** Existing record being edited, if any. Pre-fills the form. */
  existing?: ProfileRecord | null;
  /** Called with the validated values on confirmation. The caller
   * is responsible for actually persisting via profileStore. */
  onComplete: (input: { username: string; avatarId: number }) => void;
  /** When true, the modal can be dismissed via Esc / backdrop click /
   * an explicit "Cancel" button. False (default) for first-connect
   * onboarding where the user must pick something. */
  dismissable?: boolean;
  onDismiss?: () => void;
};

export const ProfileSetup: FC<ProfileSetupProps> = ({
  address,
  existing,
  onComplete,
  dismissable = false,
  onDismiss,
}) => {
  const [avatarId, setAvatarId] = useState<number>(existing?.avatarId ?? 1);
  const [username, setUsername] = useState<string>(existing?.username ?? "");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the username field on mount once the avatar stage is
  // visible. Lets the user start typing immediately — picking an
  // avatar is one click but typing needs the cursor.
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(id);
  }, []);

  // Esc handling for the dismissable variant.
  useEffect(() => {
    if (!dismissable) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && onDismiss) onDismiss();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismissable, onDismiss]);

  const trimmed = username.trim();
  const error = trimmed.length > 0 ? validateUsername(username) : null;
  const valid = error === null && trimmed.length >= PROFILE_USERNAME_LIMITS.min;

  const handleSubmit = useCallback(() => {
    if (!valid) return;
    onComplete({ username: trimmed, avatarId });
  }, [valid, trimmed, avatarId, onComplete]);

  const selected = getAvatarById(avatarId);
  const shortAddr = `${address.slice(0, 4)}…${address.slice(-4)}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={existing ? "Edit profile" : "Set up your profile"}
      style={styles.overlay}
      onMouseDown={(e) => {
        if (dismissable && e.target === e.currentTarget && onDismiss) {
          onDismiss();
        }
      }}
    >
      <div style={styles.card}>
        <header style={styles.header}>
          <span style={styles.eyebrow}>{existing ? "Edit" : "Welcome"}</span>
          <h2 style={styles.title}>
            {existing ? "Update your profile" : "Pick your avatar"}
          </h2>
          <p style={styles.subtitle}>
            {existing
              ? "Your wallet stays the source of truth. The username and avatar live only on this device."
              : "Connected as " +
                shortAddr +
                " · choose how you want to look on the terminal."}
          </p>
        </header>

        {/* Stage — large selected avatar with the per-avatar color
            ring rendered as box-shadow. The ring transition uses
            CSS so we don't need motion/react. */}
        <div style={styles.stageWrap}>
          <div
            style={{
              ...styles.stage,
              boxShadow: `0 0 0 2px rgba(${selected.rgb}, 0.55), 0 6px 24px rgba(${selected.rgb}, 0.18)`,
            }}
            aria-hidden="true"
          >
            {/* Render a 4× scale of the 36×36 SVG to fill the 160px
                circle — same trick the kokonutui original uses. */}
            <div
              key={selected.id}
              style={styles.stageInner}
              className="liminal-profile-stage-inner"
            >
              <ProfileAvatar avatarId={selected.id} size={160} />
            </div>
          </div>
          <span
            style={styles.stageLabel}
            key={`label-${selected.id}`}
            className="liminal-profile-stage-label"
          >
            {selected.alt}
          </span>
        </div>

        {/* Thumbnail strip — 4 avatars with selected highlight. Each
            renders the small SVG inside a square button; selected
            gets a check badge in the bottom-right corner. */}
        <div style={styles.thumbs} role="radiogroup" aria-label="Avatar choices">
          {AVATARS.map((avatar) => {
            const isSelected = avatar.id === avatarId;
            return (
              <button
                key={avatar.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Select ${avatar.alt}`}
                onClick={() => setAvatarId(avatar.id)}
                style={{
                  ...styles.thumb,
                  borderColor: isSelected
                    ? "var(--color-text)"
                    : "var(--color-stroke)",
                  boxShadow: isSelected
                    ? `0 0 0 2px var(--color-1), 0 0 0 4px var(--color-text)`
                    : undefined,
                  opacity: isSelected ? 1 : 0.55,
                }}
                className="liminal-press"
              >
                <span style={styles.thumbInner}>
                  <ProfileAvatar avatarId={avatar.id} size={56} />
                </span>
                {isSelected && (
                  <span style={styles.thumbCheck} aria-hidden="true">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6.5l2.5 2.5 5-5"
                        stroke="var(--color-text-inverse)"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Username field */}
        <div style={styles.field}>
          <div style={styles.fieldHeader}>
            <label htmlFor="liminal-username" style={styles.fieldLabel}>
              Username
            </label>
            <span
              style={{
                ...styles.fieldCount,
                color:
                  username.length >= PROFILE_USERNAME_LIMITS.max - 2
                    ? "var(--color-warn)"
                    : "var(--color-text-muted)",
              }}
            >
              {username.length}/{PROFILE_USERNAME_LIMITS.max}
            </span>
          </div>
          <div style={styles.inputWrap}>
            <span style={styles.inputIcon} aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <circle
                  cx="8"
                  cy="6"
                  r="3"
                  stroke={focused ? "var(--color-text)" : "var(--color-text-muted)"}
                  strokeWidth="1.4"
                />
                <path
                  d="M3 14c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5"
                  stroke={focused ? "var(--color-text)" : "var(--color-text-muted)"}
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <input
              id="liminal-username"
              ref={inputRef}
              type="text"
              autoComplete="username"
              autoCorrect="off"
              spellCheck={false}
              maxLength={PROFILE_USERNAME_LIMITS.max}
              value={username}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && valid) handleSubmit();
              }}
              placeholder="your_handle…"
              style={{
                ...styles.input,
                borderColor: error
                  ? "var(--color-danger)"
                  : focused
                    ? "var(--color-accent-border)"
                    : "var(--color-stroke)",
              }}
              aria-invalid={error !== null}
            />
          </div>
          {error && (
            <div role="alert" style={styles.errorText}>
              {error}
            </div>
          )}
        </div>

        {/* Footer — Get started + optional Cancel */}
        <div style={styles.footer}>
          {dismissable && (
            <button
              type="button"
              onClick={onDismiss}
              style={styles.cancelButton}
              className="liminal-press"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={!valid}
            onClick={handleSubmit}
            style={{
              ...styles.primaryButton,
              opacity: valid ? 1 : 0.5,
              cursor: valid ? "pointer" : "not-allowed",
            }}
            className="liminal-press"
          >
            <span>{existing ? "Save changes" : "Get started"}</span>
            <span aria-hidden="true" style={{ transition: "transform 200ms" }}>
              →
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--color-overlay, rgba(0, 0, 0, 0.5))",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 250,
    animation: "liminal-scale-in 200ms var(--ease-out, ease)",
  },
  card: {
    width: "100%",
    maxWidth: 420,
    background: "var(--surface-raised)",
    border: "1px solid var(--color-stroke)",
    borderRadius: 18,
    boxShadow:
      "0 28px 64px rgba(0, 0, 0, 0.18), 0 8px 20px rgba(0, 0, 0, 0.08)",
    padding: 28,
    display: "flex",
    flexDirection: "column",
    gap: 20,
  },
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    textAlign: "center",
  },
  eyebrow: {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: "0.12em",
    fontWeight: 700,
    color: "var(--color-5-strong)",
    textTransform: "uppercase",
  },
  title: {
    fontFamily: SANS,
    fontWeight: 700,
    fontSize: 24,
    color: "var(--color-text)",
    margin: 0,
    letterSpacing: 0,
  },
  subtitle: {
    fontFamily: SANS,
    fontSize: 15,
    color: "var(--color-text-muted)",
    margin: 0,
    lineHeight: 1.5,
  },
  stageWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
  },
  stage: {
    width: 160,
    height: 160,
    borderRadius: "50%",
    background: "var(--surface-card)",
    overflow: "hidden",
    transition: "box-shadow 450ms var(--ease-out, ease)",
    position: "relative",
  },
  stageInner: {
    width: "100%",
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    animation: "liminal-fade-in 200ms var(--ease-out, ease)",
  },
  stageLabel: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--color-text-muted)",
    animation: "liminal-fade-in 200ms var(--ease-out, ease)",
  },
  thumbs: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
  },
  thumb: {
    position: "relative",
    aspectRatio: "1 / 1",
    width: "100%",
    borderRadius: 12,
    border: "1px solid",
    background: "var(--surface-card)",
    cursor: "pointer",
    padding: 0,
    transition:
      "opacity 200ms var(--ease-out, ease), border-color 200ms var(--ease-out, ease), box-shadow 200ms var(--ease-out, ease)",
    overflow: "hidden",
  },
  thumbInner: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  thumbCheck: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: "50%",
    background: "var(--color-text)",
    border: "2px solid var(--surface-raised)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  fieldHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  fieldLabel: {
    fontFamily: MONO,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--color-text)",
    letterSpacing: 0,
  },
  fieldCount: {
    fontFamily: MONO,
    fontSize: 13,
    fontVariantNumeric: "tabular-nums",
    transition: "color var(--motion-base) var(--ease-out)",
  },
  inputWrap: {
    position: "relative",
  },
  inputIcon: {
    position: "absolute",
    left: 12,
    top: "50%",
    transform: "translateY(-50%)",
    display: "flex",
    alignItems: "center",
    pointerEvents: "none",
  },
  input: {
    width: "100%",
    height: 40,
    padding: "0 12px 0 36px",
    fontFamily: MONO,
    fontSize: 16,
    color: "var(--color-text)",
    background: "var(--surface-input)",
    border: "1px solid",
    borderRadius: 10,
    outline: "none",
    boxShadow: "inset 0 1px 2px rgba(26, 26, 26, 0.06)",
    transition: "border-color var(--motion-base) var(--ease-out)",
  },
  errorText: {
    marginTop: 4,
    fontFamily: SANS,
    fontSize: 14,
    color: "var(--color-danger)",
  },
  footer: {
    display: "flex",
    gap: 10,
    marginTop: 4,
  },
  cancelButton: {
    flex: 1,
    padding: "10px 14px",
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: 600,
    color: "var(--color-text-muted)",
    background: "transparent",
    border: "1px solid var(--color-stroke)",
    borderRadius: 10,
    cursor: "pointer",
  },
  primaryButton: {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "10px 14px",
    fontFamily: MONO,
    fontSize: 15,
    fontWeight: 700,
    color: "var(--color-text-inverse)",
    background: "var(--color-text)",
    border: "1px solid var(--color-text)",
    borderRadius: 10,
    transition: "opacity var(--motion-base) var(--ease-out), transform 80ms var(--ease-out)",
  },
};

export default ProfileSetup;
