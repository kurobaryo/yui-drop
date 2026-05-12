/**
 * Stamp — the vermillion 3-character seal next to the hero text.
 *
 * Per the design, glyphs change per locale (zh: 寄取码, ja: 便取码, en: YUI)
 * and the subtitle changes accordingly. On mobile this is hidden via the
 * `[data-yui="stamp-wrap"] { display: none }` rule.
 */
import { useTranslation } from 'react-i18next';
import type { WashiColors } from './palettes';
import type { WashiLang } from './pickers/LangPicker';

const LABELS: Record<WashiLang, string[]> = {
  zh: ['寄', '取', '码'],
  ja: ['便', '取', '码'],
  en: ['Y', 'U', 'I'],
};

export function Stamp({ c, lang }: { c: WashiColors; lang: WashiLang }) {
  const { t } = useTranslation();
  return (
    <div
      data-yui="stamp-wrap"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}
    >
      <div
        data-yui="stamp"
        style={{
          border: `2px solid ${c.stamp}`,
          color: c.stamp,
          padding: '14px 12px',
          borderRadius: 6,
          fontFamily: '"Noto Serif JP", serif',
          fontWeight: 700,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          fontSize: 20,
          lineHeight: 1,
          transform: 'rotate(4deg)',
          opacity: 0.9,
        }}
      >
        {LABELS[lang].map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
      <div style={{ fontSize: 10, color: c.sub, letterSpacing: '0.2em' }}>
        {t('washi.stampSubtitle')}
      </div>
    </div>
  );
}

export default Stamp;
