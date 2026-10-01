/**
 * ExpiryMenu — compact expiry picker for the porcelain send composer.
 *
 * Same value model, presets and bounds as ExpiryControl (the full card used by
 * the SendFile / SendText panels), folded into a one-line trigger such as
 * "7 天后过期 ▾" that opens a small popover.
 *
 * The popover is positioned against the nearest positioned ancestor (the
 * composer's action bar), not the trigger, so it can right-align with the
 * card and stay on screen at phone widths.
 *
 * Every close path plays the exit animation (`data-closing`, see
 * v2/styles/base.css) and the popover unmounts once it has finished; reopening
 * during the exit simply turns it around. Reduced motion skips the exit.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { reducedMotion } from '../haptics';
import {
  COUNT_PRESETS,
  DAY_PRESETS,
  MAX_COUNT,
  MAX_DAYS,
  type ExpiryMode,
  type ExpiryValue,
} from './ExpiryControl';

export interface ExpiryMenuProps {
  value: ExpiryValue;
  onChange: (value: ExpiryValue) => void;
  disabled?: boolean;
}

/** Length of the close animation (`ydMenuOut`). */
const EXIT_MS = 120;

export function ExpiryMenu({ value, onChange, disabled }: ExpiryMenuProps) {
  const { t } = useTranslation();
  // `leaving`: closed, but still mounted while the exit animation runs.
  const [phase, setPhase] = useState<'closed' | 'open' | 'leaving'>('closed');
  const open = phase === 'open';
  const rootRef = useRef<HTMLDivElement>(null);
  const exitTimer = useRef<number>();
  useEffect(() => () => window.clearTimeout(exitTimer.current), []);

  const show = useCallback(() => {
    window.clearTimeout(exitTimer.current);
    setPhase('open');
  }, []);
  // The guarded updaters make a close while closed a no-op, and stop a late
  // timer from unmounting a popover that was reopened in the meantime.
  const close = useCallback(() => {
    window.clearTimeout(exitTimer.current);
    const instant = reducedMotion();
    setPhase((p) => (instant ? 'closed' : p === 'open' ? 'leaving' : p));
    if (instant) return;
    exitTimer.current = window.setTimeout(
      () => setPhase((p) => (p === 'leaving' ? 'closed' : p)),
      EXIT_MS,
    );
  }, []);

  // Close on an outside press or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  useEffect(() => {
    if (disabled) close();
  }, [disabled, close]);

  const label =
    value.mode === 'date'
      ? t('v2.porcelain.expiresDays', { n: value.days })
      : t('v2.porcelain.expiresCount', { n: value.count });
  const isDate = value.mode === 'date';
  const presets = isDate ? DAY_PRESETS : COUNT_PRESETS;
  const current = isDate ? value.days : value.count;
  const pick = (n: number) => {
    onChange(isDate ? { ...value, days: n } : { ...value, count: n });
    close();
  };
  const setCustom = (raw: string) => {
    const max = isDate ? MAX_DAYS : MAX_COUNT;
    const n = Math.max(1, Math.min(max, Number(raw) || 1));
    onChange(isDate ? { ...value, days: n } : { ...value, count: n });
  };

  return (
    <div ref={rootRef} style={{ marginLeft: 'auto', minWidth: 0 }}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : show())}
        style={{ ...trigger, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <span
          aria-hidden="true"
          data-yd="menu-caret"
          data-open={open ? '' : undefined}
          style={{ fontSize: 9, lineHeight: 1, opacity: 0.7 }}
        >
          ▾
        </span>
      </button>

      {phase !== 'closed' && (
        <div
          role="dialog"
          aria-label={t('v2.expiry.title')}
          data-yd="menu"
          data-closing={phase === 'leaving' ? '' : undefined}
          style={popover}
        >
          <div style={segTrack}>
            {(['date', 'count'] as ExpiryMode[]).map((mode) => {
              const on = value.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...value, mode })}
                  style={{
                    ...segButton,
                    background: on ? 'var(--pn)' : 'transparent',
                    color: on ? 'var(--tx)' : 'var(--tx2)',
                    fontWeight: on ? 600 : 500,
                    boxShadow: on ? 'var(--sh)' : 'none',
                  }}
                >
                  {mode === 'date' ? t('v2.expiry.byDays') : t('v2.expiry.byCount')}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {presets.map((n) => (
              <Choice key={n} active={current === n} onClick={() => pick(n)}>
                {isDate ? t('v2.expiry.days', { n }) : `${n} ${t('v2.expiry.countUnit')}`}
              </Choice>
            ))}
            <label style={customCell}>
              <input
                value={current}
                onChange={(e) => setCustom(e.target.value)}
                inputMode="numeric"
                aria-label={t('v2.expiry.custom')}
                style={customInput}
              />
              <span style={{ fontSize: 11, color: 'var(--tx3)' }}>
                {isDate ? t('v2.expiry.dayUnit') : t('v2.expiry.countUnit')}
              </span>
            </label>
          </div>
          {!isDate && (
            <div style={{ marginTop: 10, fontSize: 11.5, lineHeight: 1.5, color: 'var(--tx3)' }}>
              {t('v2.expiry.countHint')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: '8px 4px',
        border: 0,
        borderRadius: 8,
        boxShadow: active ? 'inset 0 0 0 1.5px var(--ac)' : 'inset 0 0 0 1px var(--ln)',
        background: active ? 'var(--acs)' : 'transparent',
        color: active ? 'var(--tx)' : 'var(--tx2)',
        fontFamily: 'inherit',
        fontSize: 12.5,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  );
}

const trigger: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  maxWidth: '100%',
  border: 0,
  borderRadius: 8,
  padding: '7px 10px',
  background: 'var(--p1)',
  color: 'var(--tx2)',
  fontFamily: 'inherit',
  fontSize: 13,
  whiteSpace: 'nowrap',
};

const popover: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 10px)',
  right: 0,
  zIndex: 30,
  width: 272,
  maxWidth: '100%',
  padding: 12,
  borderRadius: 14,
  background: 'var(--pn)',
  boxShadow: 'var(--shl), inset 0 0 0 1px var(--ln)',
};

const segTrack: CSSProperties = {
  display: 'flex',
  gap: 2,
  padding: 3,
  marginBottom: 10,
  borderRadius: 9,
  background: 'var(--fill)',
};

const segButton: CSSProperties = {
  flex: 1,
  padding: '6px 4px',
  border: 0,
  borderRadius: 7,
  fontFamily: 'inherit',
  fontSize: 12.5,
  cursor: 'pointer',
};

const customCell: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 8px',
  borderRadius: 8,
  boxShadow: 'inset 0 0 0 1px var(--ln)',
};

const customInput: CSSProperties = {
  width: '100%',
  minWidth: 0,
  padding: '7px 0',
  border: 0,
  background: 'transparent',
  color: 'var(--tx1)',
  fontFamily: 'inherit',
  fontSize: 12.5,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'center',
};

export default ExpiryMenu;
