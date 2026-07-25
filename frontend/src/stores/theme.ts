/**
 * Theme + accent store.
 *
 * Three switches, all reflected as attributes on <html> so `templates.css`
 * can do the work in pure CSS:
 *
 *   data-template = 'linear' | 'apple' | …   ← server-owned (admin setting)
 *   data-mode     = 'light'  | 'dark'        ← server default, visitor may override
 *   data-accent   = '<slug>' | 'custom'      ← server-owned
 *
 * ── Who owns what ─────────────────────────────────────────────────────────
 * The *site theme* (template / accent / branding) is an admin setting stored
 * server-side in settings_kv and delivered by `GET /api/config`. Changing it
 * restyles the site for every visitor with no rebuild and no redeploy.
 *
 * The *appearance mode* (light/dark) is a visitor preference layered on top:
 * the server supplies the default, the visitor may override it locally, and
 * the admin can pin it with `lock_mode` (which clears the local override).
 *
 * `hydrateFromServer()` is called once on boot with the config payload.
 *
 * NOTE: `applyToDOM` is also invoked inline at module load with the *locally
 * known* values so the first paint isn't unstyled; the server config lands a
 * moment later and re-applies. Keeping the pre-hydration attribute set means
 * no flash of an unthemed page.
 */
import { create } from 'zustand';
import { DEFAULT_TEMPLATE, resolveTemplate } from '@/themes/registry';

export type ThemeMode = 'light' | 'dark' | 'auto';

/** Server-delivered theme block from `GET /api/config`. */
export interface ServerTheme {
  template: string;
  mode: string;
  accent: string;
  accent_custom: string;
  brand_name: string;
  hero_title: string;
  hero_subtitle: string;
  default_lang: string;
  logo_url: string;
  lock_mode: boolean;
}

interface ThemeState {
  /** Active template slug (server-owned). */
  template: string;
  /** Visitor-effective mode preference. */
  mode: ThemeMode;
  /** Active accent slug, or 'custom'. */
  accent: string;
  /** Hex used when accent === 'custom'. */
  accentCustom: string;
  /** When true the visitor-side light/dark toggle is hidden. */
  lockMode: boolean;
  /** Branding overrides (empty string = use the built-in default). */
  brandName: string;
  heroTitle: string;
  heroSubtitle: string;
  logoUrl: string;

  setTemplate: (t: string) => void;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: string, customHex?: string) => void;
  /** Apply the server's theme; visitor mode override wins unless locked. */
  hydrateFromServer: (t: ServerTheme) => void;
  /** Live preview (admin theme page) — apply without persisting anything. */
  preview: (patch: Partial<ServerTheme>) => void;
  /** Resolve the *effective* appearance (auto → prefers-color-scheme). */
  effective: () => 'light' | 'dark';
}

const MODE_KEY = 'yui-drop:theme';
/**
 * Legacy key from the pre-template build. Only ever read, never written —
 * an old visitor's saved accent must not override the admin's site accent.
 */
const LEGACY_ACCENT_KEY = 'yui-drop:accent';

function readMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'auto';
  const v = localStorage.getItem(MODE_KEY);
  if (v === 'light' || v === 'dark' || v === 'auto') return v;
  return 'auto';
}

function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'auto') return mode;
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/** Parse '#rrggbb' → [r,g,b]; returns null when malformed. */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix a colour toward black/white by `amt` (0..1). */
function shade(rgb: [number, number, number], amt: number): string {
  const to = amt < 0 ? 0 : 255;
  const a = Math.abs(amt);
  const c = rgb.map((v) => Math.round(v + (to - v) * a));
  return `rgb(${c[0]} ${c[1]} ${c[2]})`;
}

/**
 * Push the three attributes (plus custom-accent vars) onto <html>.
 *
 * For a custom accent we can't precompute the soft/hover variants in CSS, so
 * we derive them here and write them as inline custom properties that
 * `templates.css` aliases via `:root[data-accent="custom"]`.
 */
function applyToDOM(
  template: string,
  mode: ThemeMode,
  accent: string,
  accentCustom: string,
): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-template', template);
  root.setAttribute('data-mode', resolveMode(mode));
  // Keep the legacy attribute in sync — pre-existing components and the
  // Tailwind `darkMode` selector still key off `data-theme`.
  root.setAttribute('data-theme', resolveMode(mode));
  root.setAttribute('data-accent', accent || resolveTemplate(template).defaultAccent);

  if (accent === 'custom') {
    const rgb = hexToRgb(accentCustom);
    if (rgb) {
      root.style.setProperty('--ac-custom', accentCustom);
      root.style.setProperty(
        '--acs-custom',
        `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.14)`,
      );
      // Hover/active tone: lighten in dark mode, darken in light mode so the
      // custom accent stays legible against the active surface either way.
      const dark = resolveMode(mode) === 'dark';
      root.style.setProperty('--act-custom', shade(rgb, dark ? 0.28 : -0.22));
    }
  } else {
    root.style.removeProperty('--ac-custom');
    root.style.removeProperty('--acs-custom');
    root.style.removeProperty('--act-custom');
  }
}

const initialTemplate = DEFAULT_TEMPLATE;
const initialMode = readMode();
const initialAccent = resolveTemplate(initialTemplate).defaultAccent;

export const useThemeStore = create<ThemeState>((set, get) => ({
  template: initialTemplate,
  mode: initialMode,
  accent: initialAccent,
  accentCustom: '',
  lockMode: false,
  brandName: '',
  heroTitle: '',
  heroSubtitle: '',
  logoUrl: '',

  setTemplate: (t) => {
    const tpl = resolveTemplate(t);
    // Switching template may invalidate the current accent (each template
    // ships its own palette) — fall back to the new template's default.
    const { accent, accentCustom, mode } = get();
    const stillValid =
      accent === 'custom' || tpl.accents.some((a) => a.id === accent);
    const nextAccent = stillValid ? accent : tpl.defaultAccent;
    set({ template: tpl.id, accent: nextAccent });
    applyToDOM(tpl.id, mode, nextAccent, accentCustom);
  },

  setMode: (m) => {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
    const { template, accent, accentCustom } = get();
    set({ mode: m });
    applyToDOM(template, m, accent, accentCustom);
  },

  setAccent: (a, customHex) => {
    const { template, mode, accentCustom } = get();
    const nextCustom = customHex ?? accentCustom;
    set({ accent: a, accentCustom: nextCustom });
    applyToDOM(template, mode, a, nextCustom);
  },

  hydrateFromServer: (t) => {
    const tpl = resolveTemplate(t.template);
    const accent =
      t.accent && (t.accent === 'custom' || tpl.accents.some((a) => a.id === t.accent))
        ? t.accent
        : tpl.defaultAccent;

    // Visitor's local light/dark choice wins over the server default — unless
    // the admin locked the mode, in which case we drop the local override so
    // the pinned appearance actually sticks on the next visit too.
    const serverMode: ThemeMode =
      t.mode === 'light' || t.mode === 'dark' || t.mode === 'auto'
        ? (t.mode as ThemeMode)
        : 'auto';
    let mode: ThemeMode;
    if (t.lock_mode) {
      mode = serverMode;
      try {
        localStorage.removeItem(MODE_KEY);
      } catch {
        /* ignore */
      }
    } else {
      const stored =
        typeof localStorage !== 'undefined'
          ? localStorage.getItem(MODE_KEY)
          : null;
      mode =
        stored === 'light' || stored === 'dark' || stored === 'auto'
          ? (stored as ThemeMode)
          : serverMode;
    }

    set({
      template: tpl.id,
      mode,
      accent,
      accentCustom: t.accent_custom || '',
      lockMode: !!t.lock_mode,
      brandName: t.brand_name || '',
      heroTitle: t.hero_title || '',
      heroSubtitle: t.hero_subtitle || '',
      logoUrl: t.logo_url || '',
    });
    applyToDOM(tpl.id, mode, accent, t.accent_custom || '');
  },

  preview: (patch) => {
    const s = get();
    const template = patch.template ?? s.template;
    const tpl = resolveTemplate(template);
    const rawAccent = patch.accent ?? s.accent;
    const accent =
      rawAccent === 'custom' || tpl.accents.some((a) => a.id === rawAccent)
        ? rawAccent
        : tpl.defaultAccent;
    const accentCustom = patch.accent_custom ?? s.accentCustom;
    const mode: ThemeMode =
      patch.mode === 'light' || patch.mode === 'dark' || patch.mode === 'auto'
        ? (patch.mode as ThemeMode)
        : s.mode;

    set({
      template: tpl.id,
      mode,
      accent,
      accentCustom,
      brandName: patch.brand_name ?? s.brandName,
      heroTitle: patch.hero_title ?? s.heroTitle,
      heroSubtitle: patch.hero_subtitle ?? s.heroSubtitle,
      logoUrl: patch.logo_url ?? s.logoUrl,
      lockMode: patch.lock_mode ?? s.lockMode,
    });
    applyToDOM(tpl.id, mode, accent, accentCustom);
  },

  effective: () => resolveMode(get().mode),
}));

/** Structure slots for the active template — see `themes/registry.ts`. */
export function useSlots() {
  const template = useThemeStore((s) => s.template);
  return resolveTemplate(template).slots;
}

// Initial application + system preference listener for auto mode.
if (typeof window !== 'undefined') {
  // Migrate a legacy accent only if it happens to be valid for the default
  // template; otherwise ignore it (the server is authoritative anyway).
  let bootAccent = initialAccent;
  try {
    const legacy = localStorage.getItem(LEGACY_ACCENT_KEY);
    if (legacy && resolveTemplate(initialTemplate).accents.some((a) => a.id === legacy)) {
      bootAccent = legacy;
    }
  } catch {
    /* ignore */
  }
  applyToDOM(initialTemplate, initialMode, bootAccent, '');

  const mql = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    const s = useThemeStore.getState();
    if (s.mode === 'auto') {
      applyToDOM(s.template, 'auto', s.accent, s.accentCustom);
    }
  };
  if (mql.addEventListener) {
    mql.addEventListener('change', onChange);
  } else if (
    (mql as unknown as { addListener?: (fn: () => void) => void }).addListener
  ) {
    (mql as unknown as { addListener: (fn: () => void) => void }).addListener(
      onChange,
    );
  }
}
