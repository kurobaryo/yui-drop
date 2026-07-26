/**
 * HapticTap — wraps a control so a finger tap fires a native iOS haptic.
 *
 * Why this exists: iOS has never implemented the web Vibration API, and as of
 * iOS 26.5 Apple also blocked the scripted `<input switch>` workaround. The one
 * route left is a *direct* tap on a real WebKit switch control, so this
 * component lays an invisible native switch over its children and lets the
 * user's finger hit that instead of the visible element.
 *
 * Load-bearing details (each one silently kills the haptic if changed):
 *   - The switch keeps its native appearance. Do NOT set `appearance: none`.
 *   - `opacity: 0`, never `display: none` / `visibility: hidden` — it has to
 *     stay rendered and hit-testable.
 *   - It fills the wrapper via `width/height: 100%`, otherwise the small
 *     intrinsic control leaves dead zones around the edges.
 *   - The hit area is rounded with `clip-path`, not `overflow: hidden` +
 *     `border-radius` — the latter clips paint only, so corners just outside a
 *     pill would still be tappable.
 *   - Children get `pointer-events: none`; they are decoration, the switch is
 *     the real target.
 *
 * Android is unaffected: it goes through `navigator.vibrate` in the same
 * handler, and the overlaid checkbox is simply invisible and inert-looking.
 *
 * Technique verified on-device against iOS 26.5 by
 * https://github.com/m1ckc3s/project-fathom.
 */
import { useCallback, useRef, type CSSProperties, type ReactNode } from 'react';

import { haptic, hapticsEnabled, reducedMotion, type HapticPattern } from '../haptics';

export interface HapticTapProps {
  children: ReactNode;
  /** Fired on tap/click. */
  onTap?: () => void;
  /** Vibration pattern used on Android. Default 'tap'. */
  pattern?: HapticPattern;
  /** Border radius of the hit area, in px. Match the visible control. */
  radius?: number;
  /** Applied to the wrapper. */
  style?: CSSProperties;
  disabled?: boolean;
  /** Accessible label — the switch is the focusable element. */
  label?: string;
}

export function HapticTap({
  children,
  onTap,
  pattern = 'tap',
  radius = 10,
  style,
  disabled = false,
  label,
}: HapticTapProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handle = useCallback(() => {
    if (disabled) return;
    // Android path. On iOS this is a no-op and the tick has already been
    // produced by the finger landing on the native switch itself.
    haptic(pattern);
    // Keep the control stateless: it is a button, not a toggle.
    if (inputRef.current) inputRef.current.checked = false;
    onTap?.();
  }, [disabled, onTap, pattern]);

  const wrapper: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    ...style,
  };

  const overlay: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    margin: 0,
    opacity: 0,
    cursor: disabled ? 'not-allowed' : 'pointer',
    clipPath: `inset(0 round ${radius}px)`,
    WebkitTapHighlightColor: 'transparent',
    touchAction: 'manipulation',
  };

  // With haptics off or reduced-motion set there is no reason to intercept the
  // touch at all — render the children as a plain clickable wrapper.
  if (disabled || !hapticsEnabled() || reducedMotion()) {
    return (
      <div style={wrapper} onClick={disabled ? undefined : onTap}>
        {children}
      </div>
    );
  }

  return (
    <div style={wrapper}>
      <div style={{ pointerEvents: 'none', display: 'contents' }}>{children}</div>
      <input
        ref={(el) => {
          inputRef.current = el;
          // `switch` is not a valid JSX attribute, so set it imperatively.
          el?.setAttribute('switch', '');
        }}
        type="checkbox"
        role="button"
        aria-label={label}
        style={overlay}
        onChange={handle}
      />
    </div>
  );
}

export default HapticTap;
