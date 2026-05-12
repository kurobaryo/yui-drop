/**
 * GridBg — full-viewport decorative background.
 *
 * Two layers:
 *   1) very faint SVG grid (stroke uses currentColor with low alpha so the
 *      grid colour follows the active theme).
 *   2) 3 soft accent dots that float vertically (CSS `animation: float`,
 *      defined in tailwind.config.js).
 *
 * The element is fixed, pointer-events: none, z-index: -1 — purely decorative.
 */
import { cn } from '@/lib/cn';

interface GridBgProps {
  className?: string;
}

export function GridBg({ className }: GridBgProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'pointer-events-none fixed inset-0 overflow-hidden',
        '-z-10 text-[--border]',
        className,
      )}
    >
      {/* Faint grid drawn with SVG so we can keep the stroke crisp at any DPR. */}
      <svg
        className="absolute inset-0 h-full w-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern
            id="yui-grid"
            width="48"
            height="48"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 48 0 L 0 0 0 48"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.18"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#yui-grid)" />
      </svg>

      {/* Soft accent dots — purely decorative. */}
      <span
        className="absolute left-[15%] top-[20%] h-40 w-40 rounded-full blur-3xl opacity-30 animate-float"
        style={{
          background:
            'hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.45)',
        }}
      />
      <span
        className="absolute right-[10%] top-[55%] h-56 w-56 rounded-full blur-3xl opacity-25 animate-float"
        style={{
          animationDelay: '1.5s',
          background:
            'hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.35)',
        }}
      />
      <span
        className="absolute left-[55%] bottom-[15%] h-32 w-32 rounded-full blur-3xl opacity-30 animate-float"
        style={{
          animationDelay: '3s',
          background:
            'hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.4)',
        }}
      />
    </div>
  );
}

export default GridBg;
