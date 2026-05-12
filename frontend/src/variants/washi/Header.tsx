/**
 * Header — left-aligned brand mark (結 stamp + "Yui Drop" + tagline) and a
 * settings gear on the right. The tagline string ("文件快递柜" /
 * "ファイル宅配ボックス" / "FILE LOCKER") comes from `washi.tagBrand`.
 */
import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import type { WashiColors, WashiMode, WashiPaletteName } from './palettes';
import { MobileMenu } from './MobileMenu';
import type { WashiLang } from './pickers/LangPicker';

export interface HeaderProps {
  c: WashiColors;
  palette: WashiPaletteName;
  setPalette: (p: WashiPaletteName) => void;
  mode: WashiMode;
  setMode: (m: WashiMode) => void;
  lang: WashiLang;
  setLang: (l: WashiLang) => void;
}

// CSS custom properties used by the mobile <style> block (`var(--paper-blur)`,
// `var(--soft-c)`). React typings need them widened to a string-keyed map.
type CSSWithVars = CSSProperties & Record<`--${string}`, string>;

export function Header({ c, palette, setPalette, mode, setMode, lang, setLang }: HeaderProps) {
  const { t } = useTranslation();
  const headerStyle: CSSWithVars = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    '--paper-blur': `${c.paper}d9`,
    '--soft-c': c.soft,
  };
  return (
    <div data-yui="header" style={headerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, minWidth: 0 }}>
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
          <div style={{ fontWeight: 600, fontSize: 15, letterSpacing: '0.02em' }}>{t('washi.brand')}</div>
          <div style={{ fontSize: 10.5, color: c.sub, letterSpacing: '0.18em' }}>{t('washi.tagBrand')}</div>
        </div>
      </div>

      <MobileMenu
        c={c}
        palette={palette}
        setPalette={setPalette}
        mode={mode}
        setMode={setMode}
        lang={lang}
        setLang={setLang}
      />
    </div>
  );
}

export default Header;
