/**
 * ExpiryControl — shared by v2 SendFile and SendText panels.
 * Ported from the prototype's identical right column in both tabs.
 */
import type { ReactNode } from 'react';

export type ExpiryMode = 'date' | 'count';
export interface ExpiryValue {
  mode: ExpiryMode;
  days: number;
  count: number;
}

const DAY_PRESETS = [1, 3, 7, 14, 30];
const COUNT_PRESETS = [1, 3, 5, 10, 50];

export interface ExpiryControlProps {
  value: ExpiryValue;
  onChange: (value: ExpiryValue) => void;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '9px 6px',
        textAlign: 'center',
        border: `1px solid ${active ? 'var(--ac)' : 'var(--ln)'}`,
        background: active ? 'var(--acs)' : 'transparent',
        color: active ? 'var(--act)' : 'var(--tx2)',
        borderRadius: 8,
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  );
}

export function ExpiryControl({ value, onChange }: ExpiryControlProps) {
  const setMode = (mode: ExpiryMode) => onChange({ ...value, mode });
  return (
    <div style={{ border: '1px solid var(--ln)', borderRadius: 12, padding: 16, background: 'var(--p2)' }}>
      <div style={{ fontSize: 12, color: 'var(--tx3)', marginBottom: 12 }}>过期方式</div>
      <div style={{ display: 'flex', gap: 2, background: 'var(--p1)', border: '1px solid var(--ln)', borderRadius: 9, padding: 3, marginBottom: 14 }}>
        {(['date', 'count'] as const).map((mode) => {
          const active = value.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setMode(mode)}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: 7,
                borderRadius: 6,
                fontSize: 13,
                cursor: 'pointer',
                background: active ? 'var(--pn)' : 'transparent',
                color: active ? 'var(--tx)' : 'var(--tx2)',
                fontWeight: active ? 600 : 500,
                border: 'none',
                boxShadow: active ? 'var(--sh)' : 'none',
                fontFamily: 'inherit',
              }}
            >
              {mode === 'date' ? '按天数' : '按取件次数'}
            </button>
          );
        })}
      </div>

      {value.mode === 'date' ? (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
            {DAY_PRESETS.map((d) => (
              <Chip key={d} active={value.days === d} onClick={() => onChange({ ...value, days: d })}>
                {d} 天
              </Chip>
            ))}
          </div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--tx3)', whiteSpace: 'nowrap' }}>自定义</span>
            <input
              value={value.days}
              onChange={(e) => onChange({ ...value, days: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
              inputMode="numeric"
              style={smallInput}
            />
            <span style={{ fontSize: 11, color: 'var(--tx3)' }}>天</span>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              value={value.count}
              onChange={(e) => onChange({ ...value, count: Math.max(1, Math.min(999, Number(e.target.value) || 1)) })}
              inputMode="numeric"
              style={{ ...smallInput, height: 54, padding: '0 12px', fontSize: 26, textAlign: 'center' }}
            />
            <span style={{ fontSize: 13, color: 'var(--tx3)' }}>次</span>
          </div>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--tx3)' }}>取满次数后自动失效，可自行输入 1–999</div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            {COUNT_PRESETS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ ...value, count: n })}
                style={{
                  flex: 1,
                  textAlign: 'center',
                  padding: 6,
                  border: `1px solid ${value.count === n ? 'var(--ac)' : 'var(--ln)'}`,
                  background: value.count === n ? 'var(--acs)' : 'transparent',
                  color: value.count === n ? 'var(--act)' : 'var(--tx2)',
                  borderRadius: 6,
                  fontSize: 11,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
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

const smallInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 34,
  padding: '0 10px',
  border: '1px solid var(--ln2)',
  borderRadius: 8,
  background: 'var(--p1)',
  color: 'var(--tx1)',
  fontFamily: "'JetBrains Mono',monospace",
  fontSize: 13,
  outline: 'none',
};

export function expiryToApi(v: ExpiryValue): { expire_value: number; expire_style: 'day' | 'count' } {
  return v.mode === 'date'
    ? { expire_value: v.days, expire_style: 'day' }
    : { expire_value: v.count, expire_style: 'count' };
}
