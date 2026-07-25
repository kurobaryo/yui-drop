/**
 * v2 theme contract — the single source of truth for what a theme must define.
 *
 * ── Adding a new theme (the whole checklist) ─────────────────────────────
 *   1. Add a CSS block to `styles/themes/<slug>.css` defining the REQUIRED
 *      tokens below (and any optional ones you want to override).
 *   2. Append one entry to `THEMES` in `themes.ts`.
 *   3. Done. No component edits, no backend change, no rebuild to switch.
 *
 * The backend deliberately does not whitelist theme slugs (it validates shape
 * only), so shipping a theme never requires a backend deploy.
 *
 * ── Why tokens rather than per-theme components ──────────────────────────
 * Every visual difference between the shipped designs (Linear, Apple) is
 * expressible as a token value: surface colours, line colours, text ramp,
 * accent triplet, shadows, and — critically — SHAPE (radii). Shape is the one
 * people forget: a theme whose identity is "big pills and soft shadows" will
 * silently render with the previous theme's corners if radii aren't tokens.
 */

/** Tokens every theme MUST define. Missing one falls back to the base theme. */
export const REQUIRED_TOKENS = [
  // Surfaces
  '--bg', // page background
  '--pn', // panel / card background
  '--p1', // subtle raised surface
  '--p2', // stronger raised surface
  // Lines
  '--ln', // hairline border
  '--ln2', // stronger border
  // Text ramp (strongest → faintest)
  '--tx',
  '--tx1',
  '--tx2',
  '--tx3',
  // Accent triplet: base / soft wash / pressed-or-strong
  '--ac',
  '--acs',
  '--act',
  // Status
  '--ok',
  '--warn',
  '--bad',
  // Elevation
  '--sh', // resting shadow
  '--shl', // lifted / overlay shadow
] as const;

/**
 * Optional tokens. Themes that omit these inherit the documented default, so
 * a minimal theme only has to supply REQUIRED_TOKENS.
 *
 * ★ Shape tokens live here: omit them and you inherit Linear's tight corners;
 *   define them (as the Apple theme does) to get large radii / pills.
 */
export const OPTIONAL_TOKENS: Record<string, string> = {
  '--rc': '12px', // card radius
  '--rs': '10px', // surface / input radius
  '--ri': '9px', // small inner radius (chips, icon buttons)
  '--fill': 'var(--p1)', // filled control background
  '--grab': 'var(--ln2)', // sheet grabber bar
  '--chev': 'var(--tx3)', // chevron / disclosure glyph
};

export type TokenName = (typeof REQUIRED_TOKENS)[number] | keyof typeof OPTIONAL_TOKENS;

/** One selectable accent within a theme. */
export interface AccentDef {
  /** Stable slug persisted server-side. */
  slug: string;
  /** Human label for the admin UI. */
  label: string;
  /** Swatch shown in the picker (light mode). */
  swatch: string;
}

/** A complete theme definition. */
export interface ThemeDef {
  /** Stable slug persisted server-side; also the `data-template` attribute value. */
  slug: string;
  /** Human label for the admin UI. */
  label: string;
  /** One-line description shown under the label. */
  blurb: string;
  /** Selectable accents. The first is the default. */
  accents: AccentDef[];
  /** Viewport (px) below which the theme collapses to a single column. */
  breakpoint: number;
  /** Font stack applied at the theme root. */
  fontStack: string;
  /** Whether the theme supports a dark appearance (all current ones do). */
  supportsDark: boolean;
}

/**
 * The theme registry — the ONLY place a new theme needs registering.
 *
 * Keep `slug` in sync with the CSS file name: `styles/themes/<slug>.css`.
 */
export const THEMES: ThemeDef[] = [
  {
    slug: 'linear',
    label: 'Linear 式',
    blurb: '紧凑、克制，细线分隔，适合信息密度高的场景',
    breakpoint: 820,
    supportsDark: true,
    fontStack: "'Manrope','Noto Sans SC',system-ui,sans-serif",
    accents: [
      { slug: 'sky', label: '天蓝', swatch: '#3f7bb3' },
      { slug: 'linear-blue', label: 'Linear 蓝', swatch: '#4650c8' },
      { slug: 'sapphire', label: '宝石蓝', swatch: '#1268e3' },
      { slug: 'emerald', label: '祖母绿', swatch: '#0e9f6e' },
    ],
  },
  {
    slug: 'apple',
    label: '苹果式',
    blurb: '圆润、留白充足，大圆角与柔和阴影',
    breakpoint: 860,
    supportsDark: true,
    fontStack:
      "-apple-system,BlinkMacSystemFont,'SF Pro Text','Noto Sans SC',system-ui,sans-serif",
    accents: [
      { slug: 'blue', label: '经典蓝', swatch: '#0071e3' },
      { slug: 'sky', label: '天蓝', swatch: '#3f7bb3' },
      { slug: 'graphite', label: '石墨', swatch: '#3a3a3c' },
      { slug: 'teal', label: '青碧', swatch: '#0a8a8a' },
    ],
  },
];

/** The theme used when the server sends an unknown slug. */
export const DEFAULT_THEME = 'linear';

export function getTheme(slug: string | undefined | null): ThemeDef {
  return THEMES.find((t) => t.slug === slug) ?? THEMES[0];
}

/** Accents for a theme; falls back to the default theme's list. */
export function getAccents(themeSlug: string): AccentDef[] {
  return getTheme(themeSlug).accents;
}

/**
 * Resolve an accent slug against a theme, tolerating a stale value (e.g. the
 * admin picked `emerald` under Linear, then switched to Apple which has no
 * `emerald`). Returns the theme's default accent rather than rendering
 * unstyled.
 */
export function resolveAccent(themeSlug: string, accentSlug: string | undefined): string {
  const accents = getAccents(themeSlug);
  if (accentSlug && accents.some((a) => a.slug === accentSlug)) return accentSlug;
  return accents[0]?.slug ?? '';
}
