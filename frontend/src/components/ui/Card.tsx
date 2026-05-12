/**
 * Card — thin wrapper around the global `.card` class defined in global.css.
 *
 * Forwards className/children. We accept any HTMLDivElement attributes so
 * callers can attach onClick / role / etc.
 */
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function Card({ className, children, ...rest }, ref) {
    return (
      <div ref={ref} className={cn('card p-4', className)} {...rest}>
        {children}
      </div>
    );
  },
);

export default Card;
