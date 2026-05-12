/**
 * Washi palette tokens — 4 hues × 2 modes.
 *
 * Source: `delivery/variants/washi.jsx` (`WASHI_PALETTES` / `WASHI_DARK`).
 * Keep the hex values byte-identical with the design; touching them changes
 * the visual replica.
 */

export type WashiPaletteName = 'sumi' | 'matcha' | 'ai' | 'kogane';
export type WashiMode = 'auto' | 'light' | 'dark';

export interface WashiColors {
  ink: string;
  accent: string;
  paper: string;
  soft: string;
  sub: string;
  stamp: string;
}

export const WASHI_PALETTES: Record<WashiPaletteName, WashiColors> = {
  sumi:    { ink: '#1a1614', accent: '#a8482b', paper: '#f3ecdc', soft: '#e8dfc9', sub: '#6b5a45', stamp: '#b0432a' },
  matcha:  { ink: '#1c211a', accent: '#5a7a3e', paper: '#eee7d2', soft: '#dfd6bc', sub: '#5a6047', stamp: '#5a7a3e' },
  ai:      { ink: '#15191f', accent: '#2b4d7a', paper: '#ecead8', soft: '#dadccb', sub: '#4a5566', stamp: '#2b4d7a' },
  kogane:  { ink: '#1f1810', accent: '#8a6628', paper: '#f3e9cc', soft: '#e6d9b3', sub: '#6e5a36', stamp: '#8a6628' },
};

export const WASHI_DARK: Record<WashiPaletteName, WashiColors> = {
  sumi:    { ink: '#f0e7d3', accent: '#e07a4c', paper: '#1a1612', soft: '#26211a', sub: '#9a8a72', stamp: '#e07a4c' },
  matcha:  { ink: '#e8e4d3', accent: '#a8c97a', paper: '#161a14', soft: '#222719', sub: '#8a957a', stamp: '#a8c97a' },
  ai:      { ink: '#e3e4ea', accent: '#7aa3d4', paper: '#10141c', soft: '#1a2030', sub: '#7e8aa0', stamp: '#7aa3d4' },
  kogane:  { ink: '#f0e6cc', accent: '#d4a04a', paper: '#16120a', soft: '#221c0f', sub: '#9a8a5e', stamp: '#d4a04a' },
};

/** Dot colour used inside `WashiPalettePicker` swatches — fixed across modes. */
export const PALETTE_DOT_COLORS: Record<WashiPaletteName, string> = {
  sumi: '#a8482b',
  matcha: '#5a7a3e',
  ai: '#2b4d7a',
  kogane: '#8a6628',
};

export const PALETTE_OPTIONS: WashiPaletteName[] = ['sumi', 'matcha', 'ai', 'kogane'];
