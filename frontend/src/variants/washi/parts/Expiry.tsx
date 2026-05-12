/**
 * Expiry — local UI for picking days *or* pickup count.
 *
 * The component stores a `WashiExpiry` shape internally. Consumers turn that
 * shape into the backend `{expire_value, expire_style}` pair via
 * `expiryToApi()` in `../utils`.
 */
import { useTranslation } from 'react-i18next';
import type { WashiColors } from '../palettes';
import type { WashiExpiry } from '../utils';

export interface ExpiryProps {
  c: WashiColors;
  expiry: WashiExpiry;
  setExpiry: (e: WashiExpiry) => void;
}

export function Expiry({ c, expiry, setExpiry }: ExpiryProps) {
  const { t } = useTranslation();
  const dateOpts: Array<{ v: number; label: string }> = [
    { v: 1, label: t('washi.h24') },
    { v: 7, label: t('washi.d7') },
    { v: 30, label: t('washi.d30') },
    { v: 90, label: t('washi.d90') },
    { v: Infinity, label: t('washi.forever') },
  ];

  return (
    <div
      style={{
        border: `1px solid ${c.soft}`,
        borderRadius: 10,
        padding: 18,
        background: `${c.ink}04`,
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: c.sub,
          letterSpacing: '0.08em',
          marginBottom: 12,
        }}
      >
        {t('washi.expiryTitle').toUpperCase()}
      </div>

      <div
        style={{
          display: 'flex',
          background: c.soft,
          borderRadius: 8,
          padding: 3,
          marginBottom: 14,
        }}
      >
        {(
          [
            ['date', t('washi.byDate')],
            ['count', t('washi.byCount')],
          ] as const
        ).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => setExpiry({ ...expiry, mode: k })}
            style={{
              flex: 1,
              padding: '8px',
              border: 'none',
              cursor: 'pointer',
              background: expiry.mode === k ? c.paper : 'transparent',
              color: expiry.mode === k ? c.ink : c.sub,
              borderRadius: 6,
              fontFamily: 'inherit',
              fontSize: 13,
              fontWeight: 500,
              boxShadow: expiry.mode === k ? `0 1px 2px ${c.ink}15` : 'none',
            }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {expiry.mode === 'date' ? (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
            {dateOpts.map((o) => (
              <button
                key={o.label}
                onClick={() => setExpiry({ ...expiry, days: o.v })}
                style={{
                  padding: '10px 8px',
                  border: `1px solid ${expiry.days === o.v ? c.accent : c.soft}`,
                  background: expiry.days === o.v ? `${c.accent}15` : 'transparent',
                  color: expiry.days === o.v ? c.accent : c.ink,
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 12,
                  fontWeight: 500,
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: c.sub }}>{t('washi.customDays')}:</span>
            <input
              type="number"
              min={1}
              max={3650}
              value={
                typeof expiry.days === 'number' &&
                Number.isFinite(expiry.days) &&
                ![1, 7, 30, 90].includes(expiry.days)
                  ? expiry.days
                  : ''
              }
              onChange={(e) =>
                setExpiry({
                  ...expiry,
                  days: e.target.value ? +e.target.value : 7,
                })
              }
              placeholder="—"
              style={{
                flex: 1,
                padding: '7px 10px',
                border: `1px solid ${c.soft}`,
                background: 'transparent',
                color: c.ink,
                borderRadius: 6,
                fontFamily: 'inherit',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <span style={{ fontSize: 11, color: c.sub }}>{t('washi.days')}</span>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <input
              type="number"
              min={0}
              max={999}
              value={expiry.count}
              onChange={(e) =>
                setExpiry({
                  ...expiry,
                  count: Math.min(999, Math.max(0, +e.target.value || 0)),
                })
              }
              style={{
                flex: 1,
                padding: '14px 16px',
                border: `1px solid ${c.soft}`,
                background: 'transparent',
                color: c.ink,
                borderRadius: 6,
                fontFamily: '"JetBrains Mono", monospace',
                fontSize: 28,
                outline: 'none',
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 13, color: c.sub }}>{t('washi.times')}</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: c.sub }}>
            {t('washi.countHint')}
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            {[1, 5, 10, 100, 999].map((n) => (
              <button
                key={n}
                onClick={() => setExpiry({ ...expiry, count: n })}
                style={{
                  flex: 1,
                  padding: '6px',
                  border: `1px solid ${c.soft}`,
                  background: expiry.count === n ? `${c.accent}15` : 'transparent',
                  color: expiry.count === n ? c.accent : c.sub,
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: 11,
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default Expiry;
