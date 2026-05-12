/**
 * MobileMenu — gear button that opens a centred settings modal containing
 * the palette / mode / language pickers. Used on every viewport (the design
 * uses one settings UI for desktop and mobile alike). On mobile the
 * "Settings" label is hidden via the `[data-yui="settings-label"]` rule.
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { WashiColors, WashiMode, WashiPaletteName } from './palettes';
import { PalettePicker } from './pickers/PalettePicker';
import { ModePicker } from './pickers/ModePicker';
import { LangPicker, type WashiLang } from './pickers/LangPicker';

export interface MobileMenuProps {
  c: WashiColors;
  palette: WashiPaletteName;
  setPalette: (p: WashiPaletteName) => void;
  mode: WashiMode;
  setMode: (m: WashiMode) => void;
  lang: WashiLang;
  setLang: (l: WashiLang) => void;
}

export function MobileMenu({ c, palette, setPalette, mode, setMode, lang, setLang }: MobileMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // While the settings modal is open we override the html/body background
  // with a near-black tone so the iOS status-bar / home-indicator safe areas
  // render the same colour as the modal backdrop. Without this, the body
  // continues to paint the palette `paper` colour (set by WashiApp) and the
  // safe-area edges visibly differ from the dark modal vignette.
  useEffect(() => {
    if (!open) return;
    const htmlEl = document.documentElement;
    const bodyEl = document.body;
    const prevHtmlBg = htmlEl.style.background;
    const prevBodyBg = bodyEl.style.background;
    htmlEl.style.background = '#0a0a0a';
    bodyEl.style.background = '#0a0a0a';
    return () => {
      htmlEl.style.background = prevHtmlBg;
      bodyEl.style.background = prevBodyBg;
    };
  }, [open]);

  const modal =
    open &&
    typeof document !== 'undefined' &&
    createPortal(
      <>
        {/* Solid-tone backdrop covering the viewport including iOS safe areas.
            Using pure black with alpha (not c.ink, which is the *text* colour
            and flips to a light tone in dark mode) so the status-bar and home-
            indicator regions read as the same vignette as the modal halo,
            regardless of palette or mode. */}
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9000,
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            animation: 'yuiFade .2s ease-out',
          }}
        />
        <div
          onClick={(e) => e.stopPropagation()}
          data-yui="settings-modal"
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            zIndex: 9001,
            transform: 'translate(-50%, -50%)',
            width: 'min(92vw, 420px)',
            background: c.paper,
            padding: '20px 22px',
            border: `1px solid ${c.soft}`,
            borderRadius: 18,
            boxShadow: `0 30px 80px ${c.ink}80`,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            animation: 'yuiPop .22s cubic-bezier(.22,.61,.36,1)',
            maxHeight: 'calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 32px)',
            overflowY: 'auto',
            color: c.ink,
            fontFamily: '"Noto Sans JP", "Noto Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: c.sub, letterSpacing: '0.16em' }}>
              {t('washi.settings').toUpperCase()}
            </span>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'transparent',
                border: 'none',
                color: c.sub,
                fontSize: 22,
                cursor: 'pointer',
                padding: 0,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
          <div>
            <div style={{ fontSize: 11, color: c.sub, marginBottom: 8 }}>{t('washi.palette')}</div>
            <PalettePicker c={c} palette={palette} setPalette={setPalette} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: c.sub, marginBottom: 8 }}>{t('washi.modeLabel')}</div>
            <ModePicker c={c} mode={mode} setMode={setMode} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: c.sub, marginBottom: 8 }}>{t('washi.langLabel')}</div>
            <LangPicker c={c} lang={lang} setLang={setLang} />
          </div>
        </div>
      </>,
      document.body,
    );

  return (
    <>
      <button
        data-yui="settings-btn"
        onClick={() => setOpen(true)}
        title={t('washi.settings')}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          height: 38,
          padding: '0 14px',
          borderRadius: 999,
          background: 'transparent',
          border: `1px solid ${c.soft}`,
          color: c.ink,
          cursor: 'pointer',
          flexShrink: 0,
          fontFamily: 'inherit',
          fontSize: 13,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="2.2" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M8 1.5v1.6M8 12.9v1.6M14.5 8h-1.6M3.1 8H1.5M12.6 3.4l-1.13 1.13M4.53 11.47L3.4 12.6M12.6 12.6l-1.13-1.13M4.53 4.53L3.4 3.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <span data-yui="settings-label">{t('washi.settings')}</span>
      </button>
      {modal}
    </>
  );
}

export default MobileMenu;
