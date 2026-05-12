/**
 * WashiApp — top-level surface for the Washi (warm Japanese letter) variant.
 *
 * Owns:
 *   - palette / mode / lang state (persisted to localStorage under
 *     `yui-drop:palette`, `yui-drop:mode`, `yui-drop:lang`).
 *   - which tab is active (Pickup / SendFile / SendText).
 *   - mode resolution: `auto` → reads `prefers-color-scheme` and live-updates.
 *   - deep-link consumption: `/s/:code` and `/v/:code` route into here and
 *     the URL `:code` is funneled into the Pickup tab as a one-shot prefill.
 *
 * Style strategy: every visual is inline `style={{}}` to satisfy the 1:1
 * replication requirement. The only `<style>` block is the mobile-media-query
 * one keyed off `[data-yui="…"]` attributes (also 1:1 with the source).
 */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import i18n from '@/i18n';
import type { CSSProperties } from 'react';
import {
  WASHI_DARK,
  WASHI_PALETTES,
  type WashiMode,
  type WashiPaletteName,
} from './palettes';
import { PaperTexture } from './PaperTexture';
import { Header } from './Header';
import { Stamp } from './Stamp';
import { Tabs, type WashiTab } from './Tabs';
import { Pickup } from './tabs/Pickup';
import { SendFile } from './tabs/SendFile';
import { SendText } from './tabs/SendText';
import { Recent } from './tabs/Recent';
import type { WashiLang } from './pickers/LangPicker';

const LS_PALETTE = 'yui-drop:palette';
const LS_MODE = 'yui-drop:mode';
// Lang persistence is owned by i18next (key `yui-drop:lang`), so we re-use
// that key rather than write a parallel one.

function readPalette(): WashiPaletteName {
  if (typeof window === 'undefined') return 'sumi';
  const v = localStorage.getItem(LS_PALETTE);
  if (v === 'sumi' || v === 'matcha' || v === 'ai' || v === 'kogane') return v;
  return 'sumi';
}

function readMode(): WashiMode {
  if (typeof window === 'undefined') return 'auto';
  const v = localStorage.getItem(LS_MODE);
  if (v === 'auto' || v === 'light' || v === 'dark') return v;
  return 'auto';
}

/** Map i18next code (en | zh-CN | ja) ↔ Washi short code (zh | ja | en). */
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

export function WashiApp() {
  const { t, i18n: i18nInstance } = useTranslation();
  // Deep-link prefill. `/s/:code` and `/v/:code` both land here in this build.
  const params = useParams<{ code?: string }>();
  const [prefillCode, setPrefillCode] = useState<string | null>(params.code ?? null);

  const [palette, setPalette] = useState<WashiPaletteName>(readPalette);
  const [mode, setMode] = useState<WashiMode>(readMode);
  const [lang, setLangLocal] = useState<WashiLang>(() => i18nToWashiLang(i18nInstance.language));
  const [tab, setTab] = useState<WashiTab>(prefillCode ? 'pickup' : 'pickup');

  // Resolve `auto` against the OS preference, and react live to OS changes.
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

  // Persist palette / mode.
  useEffect(() => {
    try {
      localStorage.setItem(LS_PALETTE, palette);
    } catch {
      /* ignore */
    }
  }, [palette]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_MODE, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  // Language: drive both local state (for Stamp glyphs) and i18next.
  const setLang = (l: WashiLang) => {
    setLangLocal(l);
    void i18n.changeLanguage(washiLangToI18n(l));
  };
  // Keep local in sync if i18n changes outside of us (e.g. detector at boot).
  useEffect(() => {
    const onChanged = (lng: string) => setLangLocal(i18nToWashiLang(lng));
    i18nInstance.on('languageChanged', onChanged);
    return () => {
      i18nInstance.off('languageChanged', onChanged);
    };
  }, [i18nInstance]);

  const c = useMemo(
    () => (resolvedDark ? WASHI_DARK[palette] : WASHI_PALETTES[palette]),
    [resolvedDark, palette],
  );

  const rootStyle: CSSProperties = {
    fontFamily:
      '"Noto Sans JP", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
    background: c.paper,
    color: c.ink,
    width: '100%',
    minHeight: '100%',
    overflow: 'auto',
    position: 'relative',
  };

  return (
    <div style={rootStyle}>
      <style>{`
        @keyframes yuiFade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes yuiPop { from { transform: translate(-50%, -50%) scale(.96); opacity: 0 } to { transform: translate(-50%, -50%) scale(1); opacity: 1 } }
        @media (max-width: 720px) {
          [data-yui="page"] { padding: 20px 18px 36px !important; }
          [data-yui="hero"] { font-size: 44px !important; }
          [data-yui="hero-row"] { flex-direction: column-reverse !important; align-items: flex-start !important; gap: 18px !important; margin-top: 32px !important; }
          [data-yui="stamp"] { transform: rotate(-3deg) scale(.8) !important; transform-origin: left top; }
          [data-yui="stamp-wrap"] { align-self: flex-start; flex-direction: row !important; align-items: center !important; gap: 14px !important; }
          [data-yui="header"] { flex-wrap: wrap; gap: 12px; }
          [data-yui="tabs"] { overflow-x: auto; flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch; }
          [data-yui="tabs"]::-webkit-scrollbar { display: none; }
          [data-yui="tab-btn"] { padding: 12px 14px !important; font-size: 14px !important; flex-shrink: 0; }
          [data-yui="page"] { padding: 88px 16px 32px !important; }
          [data-yui="header"] { position: fixed !important; top: 0; left: 0; right: 0; z-index: 40; padding: 14px 16px; background: var(--paper-blur, rgba(0,0,0,.35)); backdrop-filter: saturate(180%) blur(14px); -webkit-backdrop-filter: saturate(180%) blur(14px); border-bottom: 1px solid var(--soft-c, transparent); }
          [data-yui="code-cell"] { flex: 1 1 0 !important; width: auto !important; min-width: 0 !important; height: auto !important; aspect-ratio: 1 / 1 !important; font-size: 24px !important; box-sizing: border-box !important; }
          [data-yui="code-cells"] { gap: 6px !important; width: 100% !important; flex: 1 1 100% !important; }
          [data-yui="code-row"] { flex-wrap: wrap !important; }
          [data-yui="pickup-btn"] { height: 48px !important; min-width: 0 !important; width: 100% !important; margin-top: 4px !important; flex: 1 1 100% !important; }
          [data-yui="recent-name"] { order: 0 !important; flex: 1 1 auto !important; min-width: 0 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          [data-yui="recent-row"] { flex-wrap: nowrap !important; gap: 10px !important; padding: 10px 12px !important; }
          [data-yui="two-col"] { grid-template-columns: 1fr !important; gap: 18px !important; }
          [data-yui="recent-meta"] { flex-shrink: 0; }
          [data-yui="recent-copy"] { flex-shrink: 0; white-space: nowrap; }
          [data-yui="footer"] { flex-direction: column; align-items: flex-start !important; gap: 10px; }
          [data-yui="modal-shell"] { padding: 12px !important; }
          [data-yui="modal-card"] { max-height: 92vh !important; }
          [data-yui="settings-label"] { display: none; }
          [data-yui="stamp-wrap"] { display: none !important; }
        }
        @media (max-width: 420px) {
          [data-yui="code-cell"] { font-size: 22px !important; }
        }
      `}</style>
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

        <div
          data-yui="hero-row"
          style={{ marginTop: 56, display: 'flex', alignItems: 'baseline', gap: 24 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              data-yui="hero"
              style={{
                fontFamily: '"Noto Serif JP", "Noto Serif SC", serif',
                fontWeight: 500,
                fontSize: 72,
                lineHeight: 1.05,
                letterSpacing: lang === 'en' ? '-0.02em' : '0.02em',
              }}
            >
              <div>{t('washi.heroLine1')}</div>
              <div
                style={{
                  color: c.accent,
                  fontStyle: lang === 'en' ? 'italic' : 'normal',
                }}
              >
                {t('washi.heroLine2')}
              </div>
            </div>
            <div
              style={{
                marginTop: 18,
                fontSize: 13,
                color: c.sub,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: c.accent,
                  display: 'inline-block',
                }}
              />
              {t('washi.tagline')}
            </div>
          </div>

          <Stamp c={c} lang={lang} />
        </div>

        <Tabs c={c} tab={tab} setTab={setTab} />

        <div style={{ marginTop: 28 }}>
          {tab === 'pickup' && (
            <Pickup
              c={c}
              prefillCode={prefillCode}
              onPrefillConsumed={() => setPrefillCode(null)}
            />
          )}
          {tab === 'sendfile' && <SendFile c={c} />}
          {tab === 'sendtext' && <SendText c={c} />}
        </div>

        <Recent c={c} />

        <div
          data-yui="footer"
          style={{
            marginTop: 48,
            paddingTop: 20,
            borderTop: `1px solid ${c.soft}`,
            display: 'flex',
            justifyContent: 'flex-end',
            fontSize: 12,
            color: c.sub,
          }}
        >
          <span style={{ display: 'flex', gap: 16, marginLeft: 'auto' }}>
            <a style={{ color: c.sub, textDecoration: 'none' }}>{t('washi.docs')}</a>
            <a style={{ color: c.sub, textDecoration: 'none' }}>GitHub</a>
            <a href="/admin" style={{ color: c.sub, textDecoration: 'none' }}>
              {t('washi.admin')}
            </a>
          </span>
        </div>
      </div>
    </div>
  );
}

export default WashiApp;
