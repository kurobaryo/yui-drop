/**
 * ExpiryPicker — radio toggle (Date | Pickups) with a numeric input and a
 * 'Forever'/'Never' checkbox under each mode.
 *
 * Mapping to backend ShareTextRequest (zero schema change):
 *   - Date mode + checkbox off:    expire_style='day',     expire_value=days (1-365)
 *   - Pickups mode + checkbox off: expire_style='count',   expire_value=count (1-999)
 *   - Either mode + checkbox on:   expire_style='forever', expire_value=0
 *
 * The 'Forever'/'Never' checkbox disables the numeric input while it's on,
 * and we always emit expire_style='forever' when it's checked regardless of
 * which mode the radio is on.
 */
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import type { ExpireStyle } from '@/lib/api/share';

export type ExpiryMode = 'date' | 'pickups';

export interface ExpiryValue {
  mode: ExpiryMode;
  /** Days when mode='date', pickup count when mode='pickups'. */
  count: number;
  /** When true, send expire_style='forever'. */
  never: boolean;
}

export interface ExpiryPickerProps {
  value: ExpiryValue;
  onChange: (next: ExpiryValue) => void;
  disabled?: boolean;
}

export const DEFAULT_EXPIRY: ExpiryValue = {
  mode: 'date',
  count: 7,
  never: false,
};

export const DATE_MIN = 1;
export const DATE_MAX = 365;
export const PICKUPS_MIN = 1;
export const PICKUPS_MAX = 999;

/** Translate an ExpiryValue into the request fields the API expects. */
export function toExpireRequest(v: ExpiryValue): {
  expire_value: number;
  expire_style: ExpireStyle;
} {
  if (v.never) {
    return { expire_value: 0, expire_style: 'forever' };
  }
  if (v.mode === 'date') {
    return { expire_value: v.count, expire_style: 'day' };
  }
  return { expire_value: v.count, expire_style: 'count' };
}

export function ExpiryPicker({
  value,
  onChange,
  disabled = false,
}: ExpiryPickerProps) {
  const { t } = useTranslation();

  const isDate = value.mode === 'date';
  const min = isDate ? DATE_MIN : PICKUPS_MIN;
  const max = isDate ? DATE_MAX : PICKUPS_MAX;

  function setMode(mode: ExpiryMode) {
    if (disabled) return;
    // Reset to a sensible default for each mode so users don't end up with
    // 365 in the pickups field by accident.
    const count = mode === 'date' ? 7 : 5;
    onChange({ mode, count, never: false });
  }

  function setCount(raw: string) {
    if (disabled || value.never) return;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n)) {
      onChange({ ...value, count: min });
      return;
    }
    const clamped = Math.max(min, Math.min(max, n));
    onChange({ ...value, count: clamped });
  }

  function toggleNever(next: boolean) {
    if (disabled) return;
    onChange({ ...value, never: next });
  }

  const neverLabelKey = isDate
    ? 'sendFile.expireNeverDate'
    : 'sendFile.expireNeverPickups';

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-[--text-2]">{t('sendFile.expire')}</span>

      {/* Radio toggle: Date | Pickups */}
      <div
        role="radiogroup"
        aria-label="expiry-mode"
        className="inline-flex w-fit rounded-md border border-[--border] bg-[--bg-1] p-0.5 text-sm"
      >
        {(['date', 'pickups'] as const).map((m) => {
          const active = value.mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-[5px] px-3 py-1 transition-colors',
                active
                  ? 'bg-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l)_/_0.18)] text-[--text-1]'
                  : 'text-[--text-2] hover:text-[--text-1]',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              {t(`sendFile.expireMode.${m}`)}
            </button>
          );
        })}
      </div>

      {/* Numeric input + unit suffix */}
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={value.count}
          disabled={disabled || value.never}
          onChange={(e) => setCount(e.target.value)}
          aria-label={isDate ? 'expire-days' : 'expire-pickups'}
          className={cn(
            'w-20 rounded-md border border-[--border] bg-[--bg-1] px-2 py-1 text-sm font-sans text-[--text-1]',
            'focus:outline-none focus:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
            'focus:ring-1 focus:ring-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        />
        <span className="text-xs text-[--text-2]">
          {isDate
            ? t('sendFile.expireDays', { count: value.count })
            : t('sendFile.count')}
        </span>
      </div>

      {/* Forever / Never checkbox */}
      <label className="inline-flex items-center gap-2 text-xs text-[--text-2]">
        <input
          type="checkbox"
          checked={value.never}
          disabled={disabled}
          onChange={(e) => toggleNever(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-[--border] bg-[--bg-1] accent-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]"
        />
        <span>{t(neverLabelKey)}</span>
      </label>
    </div>
  );
}

export default ExpiryPicker;
