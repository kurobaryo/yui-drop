/**
 * Small helpers for the Washi variant.
 *
 *  - `useCodeInput` — 6-box OTP hook (port of `useCodeInput` in shared.jsx);
 *    re-implementing here (rather than reusing `OtpInput`) so the inline
 *    style 1:1 replica keeps refs on every cell.
 *  - `fmtSize`        — bytes → "1.2 MB"   (port of `fmtSize`)
 *  - `fmtExpiryLeft`  — Washi expiry config → "7 天" / "5 次" / "永久"
 *  - `expiryToApi`    — Washi expiry config → backend `{expire_value, expire_style}`
 *  - `expiryShort`    — server `expired_at` → "23h" / "7d" / "—"
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ClipboardEvent } from 'react';
import type { ExpireStyle } from '@/lib/api/share';

// ── Expiry value modelled exactly like washi.jsx ────────────────────────

export interface WashiExpiry {
  /** 'date' = expire after N days; 'count' = expire after N pickups. */
  mode: 'date' | 'count';
  /**
   * Days when `mode === 'date'`. May be `Infinity` (forever) or a finite
   * positive number. Default in design = 7.
   */
  days: number;
  /** Pickup count when `mode === 'count'`. Range 0–999. */
  count: number;
}

export function expiryToApi(e: WashiExpiry): { expire_value: number; expire_style: ExpireStyle } {
  if (e.mode === 'count') {
    return { expire_value: Math.max(0, Math.min(999, Math.floor(e.count))), expire_style: 'count' };
  }
  if (!Number.isFinite(e.days)) {
    return { expire_value: 0, expire_style: 'forever' };
  }
  const days = Math.max(1, Math.floor(e.days));
  return { expire_value: days, expire_style: 'day' };
}

// ── Code-input hook (6 cells, paste-to-fill, auto-fire on complete) ─────

export interface CodeInputApi {
  digits: string[];
  setDigit: (i: number, v: string) => void;
  handleKey: (i: number, e: KeyboardEvent<HTMLInputElement>) => void;
  handlePaste: (e: ClipboardEvent<HTMLDivElement>) => void;
  refs: React.MutableRefObject<Array<HTMLInputElement | null>>;
  reset: () => void;
  setValue: (s: string) => void;
  value: string;
  complete: boolean;
}

export function useCodeInput(length: number, onComplete?: (v: string) => void): CodeInputApi {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(''));
  const refs = useRef<Array<HTMLInputElement | null>>([]);

  const setDigit = (i: number, v: string) => {
    const cleaned = (v || '').replace(/[^0-9]/g, '').slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = cleaned;
      return next;
    });
    if (cleaned && i < length - 1) refs.current[i + 1]?.focus();
  };

  const handleKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < length - 1) refs.current[i + 1]?.focus();
  };

  const handlePaste = (e: ClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData?.getData('text') ?? '';
    const clean = text.replace(/[^0-9]/g, '').slice(0, length);
    if (!clean) return;
    e.preventDefault();
    const next = Array(length).fill('');
    for (let i = 0; i < clean.length; i++) next[i] = clean[i]!;
    setDigits(next);
    const focusAt = Math.min(clean.length, length - 1);
    refs.current[focusAt]?.focus();
  };

  const reset = () => {
    setDigits(Array(length).fill(''));
    refs.current[0]?.focus();
  };

  const setValue = (s: string) => {
    const clean = (s || '').replace(/[^0-9]/g, '').slice(0, length);
    const next = Array(length).fill('');
    for (let i = 0; i < clean.length; i++) next[i] = clean[i]!;
    setDigits(next);
  };

  const complete = digits.every((d) => d !== '');
  const value = digits.join('');

  const lastFired = useRef<string>('');
  useEffect(() => {
    if (complete && value !== lastFired.current) {
      lastFired.current = value;
      onComplete?.(value);
    }
    if (!complete) lastFired.current = '';
  }, [complete, value, onComplete]);

  return { digits, setDigit, handleKey, handlePaste, refs, reset, setValue, value, complete };
}

// ── Formatters (ports of `fmtSize` / `fmtExpiryLeft`) ───────────────────

export function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface ExpiryStrings {
  times: string;
  forever: string;
  h24: string;
  days: string;
}

export function fmtExpiryLeft(cfg: WashiExpiry | null, t: ExpiryStrings): string {
  if (!cfg) return '';
  if (cfg.mode === 'count') return `${cfg.count} ${t.times}`;
  if (!Number.isFinite(cfg.days)) return t.forever;
  if (cfg.days < 1) {
    // 24-hour shorthand — mirror shared.jsx's "23 h" fallback.
    const parts = t.h24.split(' ');
    return `23 ${parts[1] ?? 'h'}`;
  }
  return `${cfg.days} ${t.days}`;
}

/** Build the "23h" / "7d" / "∞" pill used by the Recent list / modal. */
export function expiryShort(expiresAt: string | null | undefined): string {
  if (!expiresAt) return '∞';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return '0';
  const sec = Math.floor(ms / 1000);
  const days = Math.floor(sec / 86400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(sec / 3600);
  if (hours >= 1) return `${hours}h`;
  const mins = Math.floor(sec / 60);
  if (mins >= 1) return `${mins}m`;
  return `${sec}s`;
}
