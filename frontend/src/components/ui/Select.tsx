/**
 * Select — native <select> wrapped with our themed styling and a chevron icon.
 *
 * We deliberately do NOT build a custom dropdown; the native widget is
 * accessible everywhere, including mobile.
 */
import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  children: ReactNode;
  selectSize?: 'sm' | 'md';
  hasError?: boolean;
}

const SIZE_CLASSES = {
  sm: 'h-10 text-sm pl-3 pr-9',
  md: 'h-11 text-base pl-3.5 pr-9',
} as const;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { children, selectSize = 'md', hasError = false, className, ...rest },
  ref,
) {
  return (
    <div className="relative inline-block w-full">
      <select
        ref={ref}
        className={cn(
          'block w-full appearance-none rounded-md bg-[--bg-1] text-[--text-1]',
          'border border-[--border]',
          'transition-colors duration-150',
          'focus:outline-none focus:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
          'focus:ring-1 focus:ring-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          SIZE_CLASSES[selectSize],
          hasError &&
            'border-red-500/60 focus:border-red-500 focus:ring-red-500',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[--text-2]"
      />
    </div>
  );
});

export default Select;
