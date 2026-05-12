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
          alignItems: 'center',
          fontSize: 12,
          color: c.sub,
          marginBottom: 6,
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {/* Tiny accent-colored ring spinner so progress never *looks* stuck
              at 0% even when a multipart upload is still hashing / signing the
              first part. The SVG keyframes are declared once below. */}
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: `2px solid ${c.soft}`,
              borderTopColor: c.accent,
              animation: 'washi-spin 0.9s linear infinite',
            }}
          />
          {t('washi.progress')}
        </span>
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
      {/* Keyframes for the spinner — scoped to this component but global to the
          document. Idempotent: multiple Progress mounts re-declare the same
          @keyframes name with the same body. */}
      <style>{`@keyframes washi-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default Progress;
