/**
 * Progress — thin accent bar with a percentage readout. 1:1 with the source
 * (just upgraded to take a 0..1 fraction *or* a 0..100 percent; we always
 * pass a 0..100 number here for parity with `useUploadSim`).
 */
import { useTranslation } from 'react-i18next';
import type { WashiColors } from '../palettes';

export function Progress({ c, progress }: { c: WashiColors; progress: number }) {
  const { t } = useTranslation();
  const pct = Math.max(0, Math.min(100, progress));
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 12,
          color: c.sub,
          marginBottom: 6,
        }}
      >
        <span>{t('washi.progress')}</span>
        <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{pct.toFixed(0)}%</span>
      </div>
      <div style={{ height: 6, background: c.soft, borderRadius: 999, overflow: 'hidden' }}>
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: c.accent,
            borderRadius: 999,
            transition: 'width .15s',
            boxShadow: `0 0 8px ${c.accent}80`,
          }}
        />
      </div>
    </div>
  );
}

export default Progress;
