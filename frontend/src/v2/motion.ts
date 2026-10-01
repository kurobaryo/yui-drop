/**
 * Motion helpers for JS-driven transitions. Every one degrades to an instant
 * change under `prefers-reduced-motion: reduce` (the CSS side has its own
 * reduce blocks in v2/styles/base.css and styles/global.css).
 */
import { flushSync } from 'react-dom';

import { reducedMotion } from './haptics';

/**
 * Apply a state change as a cross-fade of the whole page, using the View
 * Transitions API. `flushSync` makes React commit inside the callback so the
 * browser snapshots the finished new state. Browsers without the API, and
 * reduced motion, get the plain instant update.
 */
export function crossFade(update: () => void): void {
  if (
    reducedMotion() ||
    typeof document === 'undefined' ||
    typeof document.startViewTransition !== 'function'
  ) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
