/**
 * Collection page shell — provides the washi palette + paper texture without
 * pulling in the home tabs.
 *
 * The full WashiApp owns tabs / recent shares / hero copy, which don't make
 * sense on a 共享空间 page. This shell handles the same palette/mode/lang
 * resolution + paints the page background so refreshes don't white-flash,
 * then renders whatever the page passes as `children`.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import {
  type WashiColors,
  type WashiMode,
  type WashiPaletteName,
} from '@/variants/washi/palettes';
import { templateToWashi } from '@/themes/washiBridge';
import { useThemeStore } from '@/stores/theme';
import { PaperTexture } from '@/variants/washi/PaperTexture';
import { Header } from '@/variants/washi/Header';
import { Footer } from '@/variants/washi/Footer';
import type { WashiLang } from '@/variants/washi/pickers/LangPicker';

const LS_PALETTE = 'yui-drop:palette';
// Mode is persisted by the shared theme store under its own key.

function readPalette(): WashiPaletteName {
  if (typeof window === 'undefined') return 'sumi';
  const v = localStorage.getItem(LS_PALETTE);
  if (v === 'sumi' || v === 'matcha' || v === 'ai' || v === 'kogane') return v;
  return 'sumi';
}

function i18nToWashiLang(code: string): WashiLang {
  const base = (code || '').split('-')[0]?.toLowerCase();
  if (base === 'zh') return 'zh';
  if (base === 'ja') return 'ja';
  return 'en';
}

function washiLangToI18n(l: WashiLang): string {
  if (l === 'zh') return 'zh-CN';
  if (l === 'ja') return 'ja';
  return 'en';
}

export interface CollectionShellProps {
  children: (colors: WashiColors) => ReactNode;
}

export function CollectionShell({ children }: CollectionShellProps) {
  const { i18n: i18nInstance } = useTranslation();

  const [palette, setPalette] = useState<WashiPaletteName>(readPalette);
  // Appearance is owned by the shared theme store (server default merged with
  // the visitor's override + `lock_mode`), not by local state — see WashiApp.
  const storeMode = useThemeStore((s) => s.mode);
  const setStoreMode = useThemeStore((s) => s.setMode);
  const mode = storeMode as WashiMode;
  const setMode = (m: WashiMode) => setStoreMode(m as typeof storeMode);

  const [lang, setLangLocal] = useState<WashiLang>(() =>
    i18nToWashiLang(i18nInstance.language),
  );

  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);

  const resolvedDark = mode === 'auto' ? systemDark : mode === 'dark';

  // Mode persistence belongs to the theme store now; a local write here would
  // fight it (different key, no server-default merge).

  const setLang = (l: WashiLang) => {
    setLangLocal(l);
    void i18n.changeLanguage(washiLangToI18n(l));
  };
  useEffect(() => {
    const onChanged = (lng: string) => setLangLocal(i18nToWashiLang(lng));
    i18nInstance.on('languageChanged', onChanged);
    return () => {
      i18nInstance.off('languageChanged', onChanged);
    };
  }, [i18nInstance]);

  // Colours come from the active template (admin setting via /api/config);
  // appearance (light/dark) remains the visitor's own preference.
  // See `themes/washiBridge.ts` for why this returns hex rather than var().
  const template = useThemeStore((s) => s.template);
  const storeAccent = useThemeStore((s) => s.accent);
  const storeAccentCustom = useThemeStore((s) => s.accentCustom);

  const c = useMemo(
    () => templateToWashi(template, resolvedDark, storeAccent, storeAccentCustom),
    [template, resolvedDark, storeAccent, storeAccentCustom],
  );

  // Paint the active paper color onto html+body — prevents iOS safe-area
  // white bars and matches the home page's treatment.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = {
      html: document.documentElement.style.background,
      body: document.body.style.background,
    };
    document.documentElement.style.background = c.paper;
    document.body.style.background = c.paper;
    return () => {
      document.documentElement.style.background = prev.html;
      document.body.style.background = prev.body;
    };
  }, [c.paper]);

  const rootStyle: CSSProperties = {
    fontFamily:
      '"Noto Sans JP", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
    background: c.paper,
    color: c.ink,
    width: '100%',
    minHeight: '100dvh',
    overflow: 'auto',
    position: 'relative',
  };

  return (
    <div style={rootStyle}>
      <PaperTexture color={c.ink} />
      <div
        data-yui="page"
        style={{
          position: 'relative',
          maxWidth: 920,
          margin: '0 auto',
          padding: '32px 48px 48px',
        }}
      >
        <Header
          c={c}
          palette={palette}
          setPalette={setPalette}
          mode={mode}
          setMode={setMode}
          lang={lang}
          setLang={setLang}
        />
        <div style={{ marginTop: 36 }}>{children(c)}</div>
        <Footer c={c} />
      </div>
    </div>
  );
}

export default CollectionShell;
