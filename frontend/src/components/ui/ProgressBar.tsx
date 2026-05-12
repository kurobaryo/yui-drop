/**
 * ProgressBar — accent-filled bar with an optional label and speed.
 *
 * `value` is 0–100. We clamp defensively. `speed` if provided is appended to
 * the label, e.g. "42% · 1.2 MB/s".
 */
import { cn } from '@/lib/cn';

interface ProgressBarProps {
  value: number;
  label?: string;
  /** Optional speed string (already formatted), e.g. "1.2 MB/s". */
  speed?: string;
  className?: string;
}

export function ProgressBar({ value, label, speed, className }: ProgressBarProps) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-baseline justify-between text-xs text-[--text-2] mb-1.5">
        <span>{label ?? `${v.toFixed(0)}%`}</span>
        {speed ? <span className="font-mono">{speed}</span> : null}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        className="h-2 w-full overflow-hidden rounded-full bg-[--bg-2] border border-[--border]"
      >
        <div
          className="h-full transition-[width] duration-200 ease-out"
          style={{
            width: `${v}%`,
            background:
              'hsl(var(--accent-h) var(--accent-s) var(--accent-l))',
          }}
        />
      </div>
    </div>
  );
}

export default ProgressBar;
