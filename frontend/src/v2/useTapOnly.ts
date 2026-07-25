/**
 * useTapOnly — distinguishes a real tap from a horizontal drag.
 *
 * The admin tables are horizontally scrollable and their rows are clickable.
 * On touch devices a swipe to scroll the table would land on the row's
 * `onClick` and navigate away mid-gesture. This hook returns pointer handlers
 * that only fire the callback when the pointer moved less than a small
 * threshold — i.e. the user tapped rather than dragged.
 *
 * Usage:
 *   const tap = useTapOnly(() => setActiveCode(row.code));
 *   <tr {...tap}>
 */
import { useCallback, useRef } from 'react';

const MOVE_TOLERANCE_PX = 8;

export function useTapOnly<T = Element>(onTap: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
    start.current = { x: e.clientX, y: e.clientY };
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<T>) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = Math.abs(e.clientX - s.x);
      const dy = Math.abs(e.clientY - s.y);
      if (dx <= MOVE_TOLERANCE_PX && dy <= MOVE_TOLERANCE_PX) onTap();
    },
    [onTap],
  );

  const onPointerCancel = useCallback(() => {
    start.current = null;
  }, []);

  return { onPointerDown, onPointerUp, onPointerCancel };
}
