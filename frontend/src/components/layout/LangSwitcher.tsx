/**
 * LangSwitcher — globe icon button that toggles a small dropdown of the 3
 * supported languages. Uses i18n.changeLanguage directly; i18n persists the
 * choice to localStorage via the language-detector cache.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Globe, Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SUPPORTED_LANGS, type SupportedLang } from '@/i18n';

const LANG_LABELS: Record<SupportedLang, string> = {
  en: 'English',
  'zh-CN': '简体中文',
  ja: '日本語',
};

function normalize(code: string): SupportedLang {
  // Strip region for matching ("zh" → "zh-CN", "en-US" → "en").
  const base = code.split('-')[0]!;
  if (code === 'zh-CN' || base === 'zh') return 'zh-CN';
  if (base === 'ja') return 'ja';
  return 'en';
}

export function LangSwitcher() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = normalize(i18n.language || 'en');

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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

  function pick(lang: SupportedLang): void {
    void i18n.changeLanguage(lang);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={t('lang.switch')}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-md',
          'border border-[--border] text-[--text-1] bg-transparent',
          'transition-colors duration-150',
          'hover:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
          'focus:outline-none focus-visible:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
        )}
      >
        <Globe className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="listbox"
          className={cn(
            'absolute right-0 mt-2 min-w-[160px] rounded-md border border-[--border]',
            'bg-[--bg-1] shadow-lg z-30 p-1',
          )}
        >
          {SUPPORTED_LANGS.map((lng) => (
            <button
              key={lng}
              type="button"
              role="option"
              aria-selected={current === lng}
              onClick={() => pick(lng)}
              className={cn(
                'flex w-full items-center justify-between rounded px-2.5 py-1.5 text-sm',
                'text-[--text-1] hover:bg-[--bg-2]',
              )}
            >
              <span>{LANG_LABELS[lng]}</span>
              {current === lng && (
                <Check className="h-3.5 w-3.5 text-[--text-2]" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default LangSwitcher;
