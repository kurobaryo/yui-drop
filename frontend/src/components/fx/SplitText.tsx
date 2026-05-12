/**
 * SplitText — wrap each character of a string in a <span> and stagger their
 * `animationDelay` so the text "fades up" left-to-right.
 *
 * The keyframe `fadeUp` is defined in tailwind.config.js (animation.fadeUp) so
 * we can simply use the `animate-fadeUp` utility. Spaces preserve flow.
 * Respects prefers-reduced-motion via the global CSS rule in global.css.
 */
import { useMemo } from 'react';
import { cn } from '@/lib/cn';

interface SplitTextProps {
  children: string;
  /** Extra delay in ms added to every character. */
  delay?: number;
  /** Per-character stagger in ms. */
  step?: number;
  className?: string;
}

export function SplitText({
  children,
  delay = 0,
  step = 40,
  className,
}: SplitTextProps) {
  // useMemo to keep span identities stable across re-renders of the parent.
  const chars = useMemo(() => Array.from(children), [children]);

  return (
    <span className={cn('inline-block', className)} aria-label={children}>
      {chars.map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          aria-hidden="true"
          className="inline-block animate-fadeUp"
          style={{
            animationDelay: `${delay + i * step}ms`,
            // For pure-whitespace characters keep the layout space.
            whiteSpace: ch === ' ' ? 'pre' : undefined,
          }}
        >
          {ch}
        </span>
      ))}
    </span>
  );
}

export default SplitText;
