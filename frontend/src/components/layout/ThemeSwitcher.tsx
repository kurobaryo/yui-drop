/**
 * ThemeSwitcher — visitor-side light/dark control.
 *
 * Collapsed: a small capsule showing the current accent + mode. Expanding it
 * offers the three appearance modes (light / dark / auto).
 *
 * ── Why there is no accent picker here anymore ────────────────────────────
 * Accent (and template, and branding) became *site* settings owned by the
 * admin and persisted server-side — they are part of the site's identity, so
 * a visitor toggling them would fight the configured brand. Appearance
 * (light/dark) stays a visitor preference because it's a comfort/environment
 * choice, not a brand one.
 *
 * The admin can pin appearance too via the theme page's "lock mode" switch;
 * when locked this control hides itself entirely.
 */
import { useEffect, useRef, useState } from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useThemeStore, type ThemeMode } from '@/stores/theme';

const MODES: Array<{ key: ThemeMode; Icon: typeof Sun }> = [
  { key: 'light', Icon: Sun },
  { key: 'dark', Icon: Moon },
  { key: 'auto', Icon: Monitor },
];

export function ThemeSwitcher() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const lockMode = useThemeStore((s) => s.lockMode);

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

  // Admin pinned the appearance — hide the control entirely.
  if (lockMode) return null;

  const CurrentModeIcon = MODES.find((m) => m.key === mode)?.Icon ?? Monitor;

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      {/* Collapsed capsule: accent dot + current mode icon. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="theme"
        className={cn(
          'flex items-center gap-1.5 px-1.5',
          'h-6 w-14 rounded-full border border-[--ln] bg-[--p1]',
          'transition-colors duration-150',
          'hover:border-[--ac] focus:outline-none focus-visible:border-[--ac]',
        )}
      >
        <span
          className="block h-3 w-3 rounded-full border border-black/20"
          style={{ background: 'var(--ac)' }}
          aria-hidden="true"
        />
        <span className="ml-auto flex h-4 w-4 items-center justify-center text-[--tx1]">
          <CurrentModeIcon className="h-3.5 w-3.5" />
        </span>
      </button>

      {/* Expanded panel — the three appearance modes. */}
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 mt-2 flex items-center gap-1.5 z-30',
            'rounded-full border border-[--ln] bg-[--p1] px-2 py-1.5 shadow-lg',
          )}
        >
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
                  ? 'text-[--tx1]'
                  : 'text-[--tx3] hover:text-[--tx1]',
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
