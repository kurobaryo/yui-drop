/**
 * Tabs — 3-button bar: Pickup / Send file / Send text. The active tab
 * underlines in the accent colour and shifts ink colour.
 */
import { useTranslation } from 'react-i18next';
import type { WashiColors } from './palettes';

export type WashiTab = 'pickup' | 'sendfile' | 'sendtext';

const TABS: Array<{ id: WashiTab; labelKey: string; glyph: string }> = [
  { id: 'pickup', labelKey: 'washi.tabPickup', glyph: '↘' },
  { id: 'sendfile', labelKey: 'washi.tabSendFile', glyph: '↗' },
  { id: 'sendtext', labelKey: 'washi.tabSendText', glyph: '✎' },
];

export interface TabsProps {
  c: WashiColors;
  tab: WashiTab;
  setTab: (t: WashiTab) => void;
}

export function Tabs({ c, tab, setTab }: TabsProps) {
  const { t } = useTranslation();
  return (
    <div
      data-yui="tabs"
      style={{
        marginTop: 40,
        display: 'flex',
        gap: 0,
        borderBottom: `1px solid ${c.soft}`,
      }}
    >
      {TABS.map(({ id, labelKey, glyph }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          data-yui="tab-btn"
          style={{
            background: 'transparent',
            border: 'none',
            padding: '14px 22px 16px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 15,
            fontWeight: 500,
            color: tab === id ? c.ink : c.sub,
            position: 'relative',
            borderBottom: tab === id ? `2px solid ${c.accent}` : '2px solid transparent',
            marginBottom: -1,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ color: c.accent, fontSize: 12 }}>{glyph}</span>
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}

export default Tabs;
