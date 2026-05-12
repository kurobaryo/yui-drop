/**
 * ThemeSwitcher — capsule pill (collapsed) that expands on hover/click into a
 * row of 8 swatches: 5 accent colour dots + 3 mode icons (sun/moon/monitor).
 *
 * Collapsed: 56×24 capsule; left = current accent dot, right = current mode
 * icon. Click any swatch in the expanded view to apply it instantly via
 * useThemeStore.
 */
import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  useThemeStore,
  ACCENTS,
  type Accent,
  type ThemeMode,
} from '@/stores/theme';

// HSL preview values for each accent (mirrors tokens.css). Used to colour the
// dots in the switcher itself before the theme is applied.
const ACCENT_HSL: Record<Accent, string> = {
  'aurora-gold': 'hsl(41 88% 67%)',
  'champagne-gold': 'hsl(38 53% 64%)',
  'linear-blue': 'hsl(232 68% 60%)',
  sapphire: 'hsl(217 91% 60%)',
  emerald: 'hsl(160 84% 39%)',
};

const MODES: Array<{ key: ThemeMode; Icon: typeof Sun }> = [
  { key: 'light', Icon: Sun },
  { key: 'dark', Icon: Moon },
  { key: 'auto', Icon: Monitor },
];

export function ThemeSwitcher() {
  const mode = useThemeStore((s) => s.mode);
  const accent = useThemeStore((s) => s.accent);
  const setMode = useThemeStore((s) => s.setMode);
  const setAccent = useThemeStore((s) => s.setAccent);

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  function openNow() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setOpen(true);
  }

  function scheduleClose() {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
    }
    // 200ms grace period: lets the cursor cross the gap between the
    // collapsed capsule and the expanded popover without the menu vanishing.
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      closeTimer.current = null;
    }, 200);
  }

  // Clear any pending close timer on unmount.
  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) {
        clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
    };
  }, []);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const CurrentModeIcon =
    MODES.find((m) => m.key === mode)?.Icon ?? Monitor;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      {/* Collapsed capsule: 56×24, accent dot + mode icon. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="theme"
        className={cn(
          'flex items-center gap-1.5 px-1.5',
          'h-6 w-14 rounded-full border border-[--border] bg-[--bg-1]',
          'transition-colors duration-150',
          'hover:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
          'focus:outline-none focus-visible:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
        )}
      >
        <span
          className="block h-3 w-3 rounded-full border border-black/20"
          style={{ background: ACCENT_HSL[accent] }}
          aria-hidden="true"
        />
        <span className="ml-auto flex h-4 w-4 items-center justify-center text-[--text-1]">
          <CurrentModeIcon className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* Expanded panel — 5 accents then 3 modes. */}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 mt-2 flex items-center gap-1.5 z-30',
            'rounded-full border border-[--border] bg-[--bg-1] px-2 py-1.5 shadow-lg',
          )}
        >
          {ACCENTS.map((a) => (
            <button
              key={a}
              type="button"
              role="menuitemradio"
              aria-checked={accent === a}
              aria-label={`accent-${a}`}
              onClick={() => setAccent(a)}
              className={cn(
                'h-4 w-4 rounded-full border transition-transform',
                'hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
                accent === a
                  ? 'border-[--text-1]'
                  : 'border-black/20 dark:border-white/10',
              )}
              style={{ background: ACCENT_HSL[a] }}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-[--border]" aria-hidden="true" />
          {MODES.map(({ key, Icon }) => (
            <button
              key={key}
              type="button"
              role="menuitemradio"
              aria-checked={mode === key}
              aria-label={`mode-${key}`}
              onClick={() => setMode(key)}
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-full',
                'transition-colors',
                mode === key
                  ? 'text-[--text-1]'
                  : 'text-[--text-muted] hover:text-[--text-1]',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default ThemeSwitcher;
