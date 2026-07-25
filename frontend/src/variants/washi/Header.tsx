/**
 * Header — left-aligned brand mark (結 stamp + "Yui Drop" + tagline) and a
 * settings gear on the right. The tagline string ("文件快递柜" /
 * "ファイル宅配ボックス" / "FILE LOCKER") comes from `washi.tagBrand`.
 *
 * The brand mark is wrapped in <Link to="/">, so clicking the logo anywhere
 * the washi Header is rendered (home, /docs) routes back to the home page.
 *
 * The right-side pill toggles between two states based on useLocation():
 *   - on `/`           → "API" link (jumps to /docs)
 *   - anywhere else    → "Home" / "返回首页" / "ホーム" link (jumps to /)
 */
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import type { CSSProperties } from 'react';
import type { WashiColors, WashiMode, WashiPaletteName } from './palettes';
import { MobileMenu } from './MobileMenu';
import { useThemeStore } from '@/stores/theme';
import type { WashiLang } from './pickers/LangPicker';

export interface HeaderProps {
  c: WashiColors;
  /** @deprecated Site colours are admin-owned now; ignored. Kept optional so
   *  existing callers keep compiling. */
  palette?: WashiPaletteName;
  /** @deprecated See `palette`. */
  setPalette?: (p: WashiPaletteName) => void;
  mode: WashiMode;
  setMode: (m: WashiMode) => void;
  lang: WashiLang;
  setLang: (l: WashiLang) => void;
}

// CSS custom properties used by the mobile <style> block (`var(--paper-blur)`,
// `var(--soft-c)`). React typings need them widened to a string-keyed map.
type CSSWithVars = CSSProperties & Record<`--${string}`, string>;

export function Header({ c, mode, setMode, lang, setLang }: HeaderProps) {
  const { t } = useTranslation();
  // Admin-configured site name (empty = fall back to the built-in i18n brand).
  const brandName = useThemeStore((s) => s.brandName);
  const location = useLocation();
  const isHome = location.pathname === '/';
  const headerStyle: CSSWithVars = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    '--paper-blur': `${c.paper}d9`,
    '--soft-c': c.soft,
  };
  const pillStyle: CSSProperties = {
    color: c.ink,
    fontSize: 13,
    letterSpacing: '0.08em',
    textDecoration: 'none',
    height: 38,
    padding: '0 14px',
    border: `1px solid ${c.soft}`,
    borderRadius: 999,
    flexShrink: 0,
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
  };
  return (
    <div data-yui="header" style={headerStyle}>
      <Link
        to="/"
        style={{
          textDecoration: 'none',
          color: 'inherit',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            background: c.accent,
            color: c.paper,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: '"Noto Serif JP", serif',
            fontWeight: 700,
            fontSize: 18,
            boxShadow: `inset 0 0 0 1px ${c.ink}22`,
          }}
        >
          結
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: '0.02em' }}>
            {brandName || t('washi.brand')}
          </div>
          <div style={{ fontSize: 10.5, color: c.sub, letterSpacing: '0.18em' }}>{t('washi.tagBrand')}</div>
        </div>
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {isHome ? (
          <Link to="/docs" style={pillStyle}>
            API
          </Link>
        ) : (
          <Link to="/" style={pillStyle}>
            {t('washi.backToHome')}
          </Link>
        )}
        <MobileMenu
          c={c}
          mode={mode}
          setMode={setMode}
          lang={lang}
          setLang={setLang}
        />
      </div>
    </div>
  );
}

export default Header;
