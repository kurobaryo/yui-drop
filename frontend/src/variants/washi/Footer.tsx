/**
 * Footer — shared washi footer used by WashiApp (home) and ApiDocs (/docs).
 *
 * Visual is a 1:1 lift of the inline footer that used to live in WashiApp
 * (lines 310-343). The `data-yui="footer"` attribute is preserved so the
 * mobile media query in WashiApp's <style> block keeps targeting it.
 *
 * The left side carries a small "Yui-Drop · MIT" credit (i18n key
 * `washi.footerCopyright`). The right side keeps the three Docs / GitHub /
 * Admin links. GitHub stays hardcoded — it's a brand name.
 */
import { useTranslation } from 'react-i18next';
import type { WashiColors } from './palettes';

export interface FooterProps {
  c: WashiColors;
}

export function Footer({ c }: FooterProps) {
  const { t } = useTranslation();
  return (
    <div
      data-yui="footer"
      style={{
        marginTop: 48,
        paddingTop: 20,
        borderTop: `1px solid ${c.soft}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 12,
        color: c.sub,
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      {/* Both sides are inline-flex with the same align-items so the
          "Yui-Drop · MIT" baseline matches the link group baseline even
          when the row wraps on narrow viewports.

          The previous mobile rule flipped this into a vertical column,
          which produced uneven visual heights between the single-text
          left side and the multi-link right side. Keeping the row layout
          + flex-wrap means the two halves stay at the same height; on a
          truly narrow viewport the right group wraps to a new line but
          still inherits the same line-height. */}
      <span
        data-yui="footer-left"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          lineHeight: 1.4,
        }}
      >
        {t('washi.footerCopyright')}
      </span>
      <span
        data-yui="footer-links"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 16,
          lineHeight: 1.4,
        }}
      >
        <a
          href="https://github.com/kurobaryo/yui-drop#readme"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: c.sub, textDecoration: 'none' }}
        >
          {t('washi.docs')}
        </a>
        <a
          href="https://github.com/kurobaryo/yui-drop"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: c.sub, textDecoration: 'none' }}
        >
          GitHub
        </a>
        <a href="/admin" style={{ color: c.sub, textDecoration: 'none' }}>
          {t('washi.admin')}
        </a>
      </span>
    </div>
  );
}

export default Footer;
