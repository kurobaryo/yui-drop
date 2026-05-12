/**
 * Input — basic text/number input with accent-on-focus border.
 *
 * Sizes: 'sm' (h-10) | 'md' (h-11). Rounded 8px, 1px border using the live
 * --border token, switching to the accent HSL on focus.
 */
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type InputSize = 'sm' | 'md';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: InputSize;
  hasError?: boolean;
}

const SIZE_CLASSES: Record<InputSize, string> = {
  sm: 'h-10 text-sm px-3',
  md: 'h-11 text-base px-3.5',
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { inputSize = 'md', hasError = false, className, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'block w-full rounded-md bg-[--bg-1] text-[--text-1]',
        'border border-[--border]',
        'placeholder:text-[--text-muted]',
        'transition-colors duration-150',
        'focus:outline-none focus:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
        'focus:ring-1 focus:ring-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        SIZE_CLASSES[inputSize],
        hasError &&
          'border-red-500/60 focus:border-red-500 focus:ring-red-500',
        className,
      )}
      {...rest}
    />
  );
});

export default Input;
