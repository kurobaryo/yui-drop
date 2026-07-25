/**
 * Template → Washi palette bridge.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 * The public surface (Washi) was authored as a 1:1 replication of a design
 * mock, so it styles everything with inline `style={{}}` objects fed from a
 * palette object `c` (`{ ink, accent, paper, soft, sub, stamp }`). Inline
 * styles beat every CSS custom property, so the public pages ignored
 * `data-template` entirely while the admin surface (which uses token-backed
 * class names) switched correctly.
 *
 * Rather than rewrite ~420 call sites across 29 files, we retarget the *three*
 * places that construct `c` at this function. Every downstream component keeps
 * receiving the same `WashiColors` shape and needs no edit.
 *
 * ── Why hex, not var() ────────────────────────────────────────────────────
 * 51 call sites append a 2-digit alpha to a palette value (`${c.ink}14`,
 * `c.accent + "1a"`). That trick only works on 6-digit hex — a `var(--tx)`
 * would produce the invalid literal `var(--tx)14`. So this module returns
 * concrete hex strings per (template, mode), mirroring the values in
 * `styles/templates.css`.
 *
 * Keep these in sync with templates.css. The CSS file remains the source of
 * truth for token *names*; this file mirrors the *values* for the inline-style
 * surface until it is migrated to class names.
 *
 * ★ Adding a template: add one entry here as well as the CSS block, or the
 *   public pages will fall back to the linear values while the admin surface
 *   picks up the new look.
 */
import type { WashiColors } from '@/variants/washi/palettes';

/** Palette for one template in one appearance mode. */
interface TemplatePalette {
  light: WashiColors;
  dark: WashiColors;
}

/**
 * Per-template palettes, expressed in the Washi vocabulary:
 *   paper  → page background      (--bg)
 *   soft   → raised surface       (--p1 / --p2)
 *   ink    → primary text         (--tx)
 *   sub    → secondary text       (--tx2)
 *   accent → accent colour        (--ac)
 *   stamp  → accent for the seal  (--ac)
 */
const TEMPLATE_PALETTES: Record<string, TemplatePalette> = {
  linear: {
    light: {
      paper: '#fbfbfc',
      soft: '#f4f5f7',
      ink: '#14161c',
      sub: '#4b4f5b',
      accent: '#3f7bb3',
      stamp: '#3f7bb3',
    },
    dark: {
      paper: '#0b0d12',
      soft: '#171b24',
      ink: '#e6e8ee',
      sub: '#a8adba',
      accent: '#4d8ac5',
      stamp: '#4d8ac5',
    },
  },
  apple: {
    light: {
      paper: '#f5f5f7',
      soft: '#ffffff',
      ink: '#1d1d1f',
      sub: '#6e6e73',
      accent: '#0071e3',
      stamp: '#0071e3',
    },
    dark: {
      paper: '#000000',
      soft: '#1c1c1e',
      ink: '#f5f5f7',
      sub: '#98989d',
      accent: '#0a84ff',
      stamp: '#0a84ff',
    },
  },
};

/** Accent overrides per template — keyed by the accent slug. */
const ACCENTS: Record<string, Record<string, { light: string; dark: string }>> = {
  linear: {
    sky: { light: '#3f7bb3', dark: '#4d8ac5' },
    'linear-blue': { light: '#4650c8', dark: '#5d68e0' },
    sapphire: { light: '#1268e3', dark: '#3b8bf5' },
    emerald: { light: '#0e9f6e', dark: '#1cb37f' },
  },
  apple: {
    blue: { light: '#0071e3', dark: '#0a84ff' },
    sky: { light: '#3f7bb3', dark: '#4d8ac5' },
    graphite: { light: '#3a3a3c', dark: '#8e8e93' },
    teal: { light: '#0a8a8a', dark: '#30d5c8' },
  },
};

const DEFAULT_TEMPLATE = 'linear';

/** Normalise a hex string to 6 digits (`#abc` → `#aabbcc`), or null. */
function normaliseHex(hex: string): string | null {
  const s = hex.trim();
  const short = /^#?([0-9a-fA-F]{3})$/.exec(s);
  if (short) {
    const [r, g, b] = short[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const full = /^#?([0-9a-fA-F]{6})$/.exec(s);
  return full ? `#${full[1].toLowerCase()}` : null;
}

/**
 * Resolve the Washi palette for the active template.
 *
 * @param template  Active template slug (unknown slugs fall back to linear).
 * @param dark      Whether dark appearance is in effect.
 * @param accent    Active accent slug, or 'custom'.
 * @param customHex Hex used when `accent === 'custom'`.
 */
export function templateToWashi(
  template: string,
  dark: boolean,
  accent?: string,
  customHex?: string,
): WashiColors {
  const tpl = TEMPLATE_PALETTES[template] ?? TEMPLATE_PALETTES[DEFAULT_TEMPLATE];
  const base = dark ? tpl.dark : tpl.light;

  let accentHex: string | null = null;
  if (accent === 'custom' && customHex) {
    accentHex = normaliseHex(customHex);
  } else if (accent) {
    const table = ACCENTS[template] ?? ACCENTS[DEFAULT_TEMPLATE];
    const entry = table?.[accent];
    if (entry) accentHex = dark ? entry.dark : entry.light;
  }

  if (!accentHex) return base;
  return { ...base, accent: accentHex, stamp: accentHex };
}

export default templateToWashi;
