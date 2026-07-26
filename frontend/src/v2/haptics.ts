/**
 * Haptic feedback.
 *
 * Three mechanisms, because no single one covers every platform:
 *
 * 1. Android / Chrome — the Vibration API (`navigator.vibrate`). Real, spec'd,
 *    supports multi-pulse patterns. Programmatic, so it works from anywhere.
 *
 * 2. iOS 17.4 – 26.4 — Safari never shipped the Vibration API, but WebKit's
 *    native switch control (`<input type="checkbox" switch>`) makes the system
 *    play a haptic tick when toggled, and back then a scripted `.click()` was
 *    enough to trigger it.
 *
 * 3. iOS 26.5+ — Apple closed the scripted path: only a *direct finger tap* on
 *    a real switch control still fires the tick. So a scripted `haptic()` call
 *    can no longer produce feedback on current iOS. What does work is putting
 *    an invisible native switch *under the user's finger* — see `HapticTap`
 *    below, which overlays one on top of a regular-looking control.
 *
 * Practical consequence: use `haptic()` for outcomes that happen away from the
 * touch (upload finished, request failed) — those buzz on Android only. Wrap
 * important buttons in `<HapticTap>` when you want them to buzz on iOS too.
 *
 * Reference: the technique is verified on-device against iOS 26.5 by
 * https://github.com/m1ckc3s/project-fathom.
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

export function hapticsEnabled(): boolean {
  return enabled;
}

/** True when the Vibration API is available (Android). False on iOS. */
export function vibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Fire a haptic pattern programmatically.
 *
 * Android: real vibration. iOS: no-op — Apple allows no scripted route to the
 * Taptic Engine as of 26.5. Use `<HapticTap>` for tap-driven feedback there.
 *
 * @returns true if a vibration was actually requested.
 */
export function haptic(pattern: HapticPattern = 'tap'): boolean {
  if (!enabled || reducedMotion() || !vibrationSupported()) return false;
  try {
    return navigator.vibrate(PATTERNS[pattern]);
  } catch {
    return false;
  }
}
