/**
 * Spinner — Loader2 from lucide with the `animate-spin` utility applied.
 */
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

interface SpinnerProps {
  className?: string;
  /** Pixel size for width & height. */
  size?: number;
}

export function Spinner({ className, size = 16 }: SpinnerProps) {
  return (
    <Loader2
      className={cn('animate-spin text-[--text-2]', className)}
      width={size}
      height={size}
      aria-label="loading"
    />
  );
}

export default Spinner;
