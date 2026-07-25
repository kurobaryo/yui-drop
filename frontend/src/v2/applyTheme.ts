/**
 * v2 theme application.
 *
 * Writes `data-template` / `data-mode` / `data-accent` onto <html>. Every visual
 * rule in v2 keys off those three attributes, so switching a theme is one
 * attribute write — no rebuild, no remount, no per-component work.
 *
 * Ownership model (matches the design's "saving applies to all visitors"):
 *   - theme + accent + branding  → SITE identity, admin-owned, from /api/config
 *   - light/dark                 → visitor comfort, local override allowed
 *     unless the admin sets lock_mode
 */
import { useEffect } from 'react';

import { DEFAULT_THEME, getTheme, resolveAccent } from './themes';

export type Mode = 'light' | 'dark' | 'auto';

export interface AppliedTheme {
  theme: string;
  mode: Mode;
  accent: string;
  /** Custom hex; only honoured when `accent === 'custom'`. */
  accentCustom?: string;
}

/** Resolve `auto` against the OS preference. */
export function resolveMode(mode: Mode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Normalise `#abc` / `abc` / `#aabbcc` → `#aabbcc`, else null. */
export function normaliseHex(hex: string): string | null {
  const s = (hex || '').trim();
  const short = /^#?([0-9a-fA-F]{3})$/.exec(s);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = /^#?([0-9a-fA-F]{6})$/.exec(s);
  return full ? `#${full[1].toLowerCase()}` : null;
}

/** Mix a hex toward white/black by `amount` (0..1). */
function shift(hex: string, amount: number, toward: 'white' | 'black'): string {
  const n = normaliseHex(hex);
  if (!n) return hex;
  const to = toward === 'white' ? 255 : 0;
  const parts = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16));
  const out = parts.map((v) => Math.round(v + (to - v) * amount));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** `#rrggbb` → `rgba(r,g,b,a)`. */
function withAlpha(hex: string, alpha: number): string {
  const n = normaliseHex(hex);
  if (!n) return hex;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Apply a theme to the document.
 *
 * A custom accent can't be expressed as a static CSS rule (the hex is only
 * known at runtime), so its three tokens are written as inline custom
 * properties on <html>, which outrank the theme stylesheet. For preset
 * accents we clear them so the stylesheet wins again.
 */
export function applyTheme(t: AppliedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  const theme = getTheme(t.theme).slug || DEFAULT_THEME;
  const resolved = resolveMode(t.mode);

  root.setAttribute('data-template', theme);
  root.setAttribute('data-mode', resolved);
  // Existing Tailwind dark-mode and legacy components key off data-theme.
  // Keep it as the APPEARANCE alias; template identity lives in data-template.
  root.setAttribute('data-theme', resolved);

  const custom = t.accent === 'custom' ? normaliseHex(t.accentCustom || '') : null;
  if (custom) {
    root.setAttribute('data-accent', 'custom');
    const dark = resolved === 'dark';
    root.style.setProperty('--ac', custom);
    root.style.setProperty('--acs', withAlpha(custom, dark ? 0.2 : 0.14));
    // Lighten for dark backgrounds, darken for light ones, so the "strong"
    // accent keeps contrast against the surface it sits on.
    root.style.setProperty('--act', shift(custom, 0.25, dark ? 'white' : 'black'));
  } else {
    root.setAttribute('data-accent', resolveAccent(theme, t.accent));
    root.style.removeProperty('--ac');
    root.style.removeProperty('--acs');
    root.style.removeProperty('--act');
  }

  // Font stack is per-theme and can't live in the token block (it's applied at
  // the root element, which the CSS also targets, but setting it here keeps
  // the value colocated with the theme definition).
  root.style.setProperty('--yd-font', getTheme(theme).fontStack);
}

/**
 * Keep the document in sync with `theme`, re-resolving when the OS appearance
 * changes (only relevant while mode is `auto`).
 */
export function useApplyTheme(theme: AppliedTheme): void {
  const { theme: slug, mode, accent, accentCustom } = theme;

  useEffect(() => {
    applyTheme({ theme: slug, mode, accent, accentCustom });
  }, [slug, mode, accent, accentCustom]);

  useEffect(() => {
    if (mode !== 'auto') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme({ theme: slug, mode, accent, accentCustom });
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [slug, mode, accent, accentCustom]);
}
