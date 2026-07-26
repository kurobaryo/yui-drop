/**
 * Haptic feedback.
 *
 * Two mechanisms, because no single one covers both platforms:
 *
 * 1. Android / Chrome — the Vibration API (`navigator.vibrate`). Real, spec'd,
 *    supports multi-pulse patterns.
 *
 * 2. iOS Safari — never implemented the Vibration API and, as of iOS 26.5,
 *    Apple also closed the `<input type="checkbox" switch>` trick that used to
 *    emit a Taptic tick when toggled (it worked from 17.4 to 26.4). We still
 *    attempt it: devices on 17.4–26.4 get real haptics, newer ones silently
 *    get nothing. There is no supported web API that reaches the Taptic Engine
 *    from a normal page, so on current iOS this is a genuine no-op — the
 *    function must never be described to users as "works everywhere".
 *
 * Call at the moment of a user-visible outcome (code copied, upload finished,
 * error raised) rather than on every tap, which quickly becomes noise.
 */

export type HapticPattern = 'tap' | 'success' | 'warning' | 'error';

/** Durations in ms; arrays alternate vibrate/pause. */
const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 10,
  success: [14, 40, 14],
  warning: [20, 60, 20],
  error: [30, 50, 30, 50, 30],
};

let enabled = true;

/** Global off switch (for a future user preference). */
export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

/** True when the Vibration API is available (Android). False on iOS. */
export function vibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * The iOS fallback: a visually hidden `<input type="checkbox" switch>` with a
 * label. Toggling it via a synthetic label click makes Safari play its native
 * switch tick. Created lazily and reused.
 *
 * Only effective on iOS 17.4–26.4. Harmless elsewhere.
 */
let switchEl: HTMLInputElement | null = null;
let labelEl: HTMLLabelElement | null = null;

function ensureSwitch(): HTMLLabelElement | null {
  if (typeof document === 'undefined') return null;
  if (labelEl) return labelEl;
  try {
    const id = 'yd-haptic-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = id;
    // Non-standard Safari attribute — this is what carries the haptic.
    input.setAttribute('switch', '');
    const label = document.createElement('label');
    label.htmlFor = id;
    label.setAttribute('aria-hidden', 'true');
    const hide: Partial<CSSStyleDeclaration> = {
      position: 'fixed',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
      left: '-9999px',
      top: '0',
    };
    Object.assign(input.style, hide);
    Object.assign(label.style, hide);
    document.body.appendChild(input);
    document.body.appendChild(label);
    switchEl = input;
    labelEl = label;
    return label;
  } catch {
    return null;
  }
}

/**
 * Fire a haptic pattern. Safe to call anywhere: no-ops when disabled, when the
 * user prefers reduced motion, or when the platform offers no mechanism.
 *
 * @returns true if a vibration was actually requested (Android only).
 */
export function haptic(pattern: HapticPattern = 'tap'): boolean {
  if (!enabled || reducedMotion()) return false;

  if (vibrationSupported()) {
    try {
      return navigator.vibrate(PATTERNS[pattern]);
    } catch {
      return false;
    }
  }

  // iOS best-effort. No way to detect whether it actually fired.
  try {
    const label = ensureSwitch();
    if (label && switchEl) {
      label.click();
      switchEl.checked = false;
    }
  } catch {
    /* ignore */
  }
  return false;
}
