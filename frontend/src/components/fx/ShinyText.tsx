/**
 * ShinyText — gradient sweep across text.
 *
 * Uses the `.shiny-text` class defined in global.css. CSS-only animation,
 * respects prefers-reduced-motion. Wraps an arbitrary children element so
 * you can pick the typography (size/weight) from the call-site.
 */
import { cn } from '@/lib/cn';
import type { ReactNode, HTMLAttributes } from 'react';

interface ShinyTextProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
}

export function ShinyText({ children, className, ...rest }: ShinyTextProps) {
  return (
    <span className={cn('shiny-text', className)} {...rest}>
      {children}
    </span>
  );
}
