/**
 * Theme + accent store.
 *
 * Two switches, persisted independently:
 *   - mode: 'light' | 'dark' | 'auto' (default: 'auto')
 *   - accent: one of the 5 fixed accents (default: 'aurora-gold')
 *
 * The store also sets data-theme / data-accent on <html> so the CSS
 * variables in tokens.css can take effect. Auto mode listens to
 * prefers-color-scheme and re-applies on change.
 */
import { create } from 'zustand';

export type ThemeMode = 'light' | 'dark' | 'auto';
export type Accent =
  | 'aurora-gold'
  | 'champagne-gold'
  | 'linear-blue'
  | 'sapphire'
  | 'emerald';

export const ACCENTS: Accent[] = [
  'aurora-gold',
  'champagne-gold',
  'linear-blue',
  'sapphire',
  'emerald',
];

interface ThemeState {
  mode: ThemeMode;
  accent: Accent;
  setMode: (m: ThemeMode) => void;
  setAccent: (a: Accent) => void;
  /** Resolve the *effective* theme (auto → resolved against prefers-color-scheme). */
  effective: () => 'light' | 'dark';
}

const MODE_KEY = 'yui-drop:theme';
const ACCENT_KEY = 'yui-drop:accent';

function readMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'auto';
  const v = localStorage.getItem(MODE_KEY);
  if (v === 'light' || v === 'dark' || v === 'auto') return v;
  return 'auto';
}

function readAccent(): Accent {
  if (typeof localStorage === 'undefined') return 'aurora-gold';
  const v = localStorage.getItem(ACCENT_KEY);
  if (v && (ACCENTS as string[]).includes(v)) return v as Accent;
  return 'aurora-gold';
}

function applyToDOM(mode: ThemeMode, accent: Accent) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved =
    mode === 'auto'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : mode;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-accent', accent);
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: readMode(),
  accent: readAccent(),
  setMode: (m) => {
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* ignore */
    }
    set({ mode: m });
    applyToDOM(m, get().accent);
  },
  setAccent: (a) => {
    try {
      localStorage.setItem(ACCENT_KEY, a);
    } catch {
      /* ignore */
    }
    set({ accent: a });
    applyToDOM(get().mode, a);
  },
  effective: () => {
    const { mode } = get();
    if (mode !== 'auto') return mode;
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  },
}));

// Initial application + system preference listener for auto mode.
if (typeof window !== 'undefined') {
  const initialMode = readMode();
  const initialAccent = readAccent();
  applyToDOM(initialMode, initialAccent);

  const mql = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => {
    if (useThemeStore.getState().mode === 'auto') {
      applyToDOM('auto', useThemeStore.getState().accent);
    }
  };
  if (mql.addEventListener) {
    mql.addEventListener('change', onChange);
  } else if ((mql as unknown as { addListener: (fn: () => void) => void }).addListener) {
    (mql as unknown as { addListener: (fn: () => void) => void }).addListener(onChange);
  }
}
