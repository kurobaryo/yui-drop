/**
 * OtpInput — N independent single-character inputs for pickup codes.
 *
 * Features:
 *   - inputMode="numeric" pattern="[0-9]" maxLength={1} on every cell
 *   - Backspace on an empty cell jumps focus to the previous cell
 *   - Pasting digits anywhere distributes them across the cells and
 *     fires onComplete when the last cell is filled
 *   - Filling the final cell normally also fires onComplete
 *   - hasError swaps the border to red and adds a small shake animation
 *
 * The shake keyframe is injected once via a <style> tag at module scope so
 * we don't have to touch global.css.
 */
import {
  useEffect,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react';
import { cn } from '@/lib/cn';

const SHAKE_STYLE_ID = 'yui-otp-shake-style';
const SHAKE_CSS = `
@keyframes yuiOtpShake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(3px); }
}
.yui-otp-shake { animation: yuiOtpShake 280ms ease-in-out; }
`;

function injectShakeStyle(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SHAKE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = SHAKE_STYLE_ID;
  style.textContent = SHAKE_CSS;
  document.head.appendChild(style);
}

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
}

export function OtpInput({
  length = 6,
  value,
  onChange,
  onComplete,
  autoFocus = false,
  disabled = false,
  hasError = false,
  className,
}: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    injectShakeStyle();
  }, []);

  useEffect(() => {
    if (autoFocus) {
      refs.current[0]?.focus();
    }
  }, [autoFocus]);

  // Normalise so we always render a string of exactly `length` chars.
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  function commit(next: string, fireCompleteIfFull: boolean): void {
    const truncated = next.slice(0, length);
    onChange(truncated);
    if (
      fireCompleteIfFull &&
      onComplete &&
      truncated.length === length &&
      /^\d+$/.test(truncated)
    ) {
      onComplete(truncated);
    }
  }

  function handleChange(idx: number, e: ChangeEvent<HTMLInputElement>): void {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      // Cleared the cell.
      const arr = digits.slice();
      arr[idx] = '';
      commit(arr.join(''), false);
      return;
    }
    const arr = digits.slice();
    // If user typed multiple digits (e.g. autofill), spread them forward.
    for (let i = 0; i < raw.length && idx + i < length; i++) {
      arr[idx + i] = raw[i]!;
    }
    const joined = arr.join('').replace(/\s/g, '');
    commit(joined, true);
    // Move focus to the next empty cell, or stay on the last.
    const nextIdx = Math.min(length - 1, idx + raw.length);
    refs.current[nextIdx]?.focus();
    refs.current[nextIdx]?.select();
  }

  function handleKeyDown(idx: number, e: KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Backspace') {
      if (digits[idx]) {
        // Just clear current; default change handler will fire.
        return;
      }
      // Empty cell: hop back.
      e.preventDefault();
      const prev = Math.max(0, idx - 1);
      const arr = digits.slice();
      arr[prev] = '';
      commit(arr.join(''), false);
      refs.current[prev]?.focus();
      refs.current[prev]?.select();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      refs.current[Math.max(0, idx - 1)]?.focus();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      refs.current[Math.min(length - 1, idx + 1)]?.focus();
    }
  }

  function handlePaste(idx: number, e: ClipboardEvent<HTMLInputElement>): void {
    const text = e.clipboardData.getData('text');
    const digitsOnly = text.replace(/\D/g, '');
    if (!digitsOnly) return;
    e.preventDefault();
    const arr = digits.slice();
    for (let i = 0; i < digitsOnly.length && idx + i < length; i++) {
      arr[idx + i] = digitsOnly[i]!;
    }
    const joined = arr.join('');
    commit(joined, true);
    const focusIdx = Math.min(length - 1, idx + digitsOnly.length);
    refs.current[focusIdx]?.focus();
    refs.current[focusIdx]?.select();
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2',
        hasError && 'yui-otp-shake',
        className,
      )}
      aria-label="pickup-code"
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          pattern="[0-9]"
          maxLength={1}
          autoComplete="one-time-code"
          disabled={disabled}
          value={d}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={(e) => handlePaste(i, e)}
          onFocus={(e) => e.currentTarget.select()}
          aria-invalid={hasError || undefined}
          className={cn(
            'h-12 w-10 md:h-14 md:w-12 text-center text-xl md:text-2xl font-mono',
            'rounded-md bg-[--bg-1] text-[--text-1]',
            'border border-[--border]',
            'transition-colors duration-150',
            'focus:outline-none focus:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
            'focus:ring-1 focus:ring-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            hasError &&
              'border-red-500/60 focus:border-red-500 focus:ring-red-500',
          )}
        />
      ))}
    </div>
  );
}

export default OtpInput;
