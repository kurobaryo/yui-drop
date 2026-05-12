/**
 * LangPicker — zh / ja / en as three glyphs. The values map to the
 * design's `zh|ja|en` keys, which `WashiApp` then maps to the i18next
 * resource codes `zh-CN|ja|en`.
 */
import type { WashiColors } from '../palettes';

export type WashiLang = 'zh' | 'ja' | 'en';

export interface LangPickerProps {
  c: WashiColors;
  lang: WashiLang;
  setLang: (l: WashiLang) => void;
}

const OPTIONS: Array<[WashiLang, string]> = [
  ['zh', '中'],
  ['ja', '日'],
  ['en', 'EN'],
];

export function LangPicker({ c, lang, setLang }: LangPickerProps) {
  return (
    <div
      style={{
        display: 'flex',
        border: `1px solid ${c.soft}`,
        borderRadius: 999,
        overflow: 'hidden',
        background: `${c.paper}cc`,
      }}
    >
      {OPTIONS.map(([k, label]) => (
        <button
          key={k}
          onClick={() => setLang(k)}
          style={{
            padding: '6px 10px',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            background: lang === k ? c.ink : 'transparent',
            color: lang === k ? c.paper : c.sub,
            fontFamily: 'inherit',
            fontWeight: 600,
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export default LangPicker;
