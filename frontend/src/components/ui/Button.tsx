/**
 * Button — variants: primary | ghost | outline | danger
 *          sizes:    sm | md | lg
 *
 * Visual style follows the "border-highlight, no large fills" rule for the
 * non-primary variants. The primary variant fills with the live accent HSL.
 *
 * `loading` swaps the leading content for a spinning Loader2 and disables
 * pointer events.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Optional leading icon (rendered to the left of children). */
  leftIcon?: ReactNode;
  /** Optional trailing icon. */
  rightIcon?: ReactNode;
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm rounded-md',
  md: 'h-10 px-4 text-base rounded-md',
  lg: 'h-11 px-5 text-md rounded-md',
};

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Primary uses the live accent HSL so it follows theme changes without JS.
  primary: cn(
    'text-white border border-transparent',
    'bg-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
    'hover:bg-[hsl(var(--accent-h)_var(--accent-s)_calc(var(--accent-l)_+_4%))]',
    'active:bg-[hsl(var(--accent-h)_var(--accent-s)_calc(var(--accent-l)_-_4%))]',
    'focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent-h)_var(--accent-s)_calc(var(--accent-l)_+_10%))]',
  ),
  ghost: cn(
    'text-[--text-1] border border-transparent bg-transparent',
    'hover:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
    'focus-visible:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
  ),
  outline: cn(
    'text-[--text-1] border border-[--border] bg-transparent',
    'hover:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
    'focus-visible:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
  ),
  danger: cn(
    'text-red-200 border border-red-500/50 bg-transparent',
    'hover:border-red-400 hover:text-red-100',
    'focus-visible:ring-2 focus-visible:ring-red-500/40',
  ),
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    className,
    leftIcon,
    rightIcon,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium',
        'transition-colors duration-150 select-none',
        'focus:outline-none focus-visible:outline-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon
      )}
      {children}
      {!loading && rightIcon}
    </button>
  );
});

export default Button;
