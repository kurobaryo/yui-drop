/**
 * CodeReady — large 6-digit code display shown after a successful send.
 * Mirrors the source 1:1: serif/mono blend, accent underline per digit,
 * copy + reset round buttons.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WashiColors } from '../palettes';
import { fmtExpiryLeft, type WashiExpiry } from '../utils';

export interface CodeReadyProps {
  c: WashiColors;
  code: string;
  expiry: WashiExpiry;
  onReset: () => void;
}

export function CodeReady({ c, code, expiry, onReset }: CodeReadyProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  return (
    <div
      style={{
        border: `1px solid ${c.soft}`,
        borderRadius: 12,
        padding: '36px 28px',
        textAlign: 'center',
        background: `${c.accent}06`,
        position: 'relative',
      }}
    >
      <div
        style={{
          fontSize: 12,
          color: c.sub,
          letterSpacing: '0.12em',
          marginBottom: 14,
        }}
      >
        {t('washi.codeReady').toUpperCase()}
      </div>
      <div
        style={{
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: 72,
          fontWeight: 600,
          color: c.ink,
          letterSpacing: '0.12em',
          lineHeight: 1,
        }}
      >
        {code.split('').map((d, i) => (
          <span
            key={i}
            style={{ borderBottom: `2px solid ${c.accent}`, padding: '0 8px' }}
          >
            {d}
          </span>
        ))}
      </div>
      <div style={{ marginTop: 18, fontSize: 13, color: c.sub }}>
        {fmtExpiryLeft(expiry, {
          times: t('washi.times'),
          forever: t('washi.forever'),
          h24: t('washi.h24'),
          days: t('washi.days'),
        })}{' '}
        · {t('washi.codeShare')}
      </div>
      <div
        style={{
          marginTop: 24,
          display: 'flex',
          gap: 10,
          justifyContent: 'center',
        }}
      >
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
          style={{
            padding: '10px 22px',
            background: c.accent,
            color: c.paper,
            border: 'none',
            borderRadius: 999,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {copied ? '✓ ' + t('washi.copied') : t('washi.copy')}
        </button>
        <button
          onClick={onReset}
          style={{
            padding: '10px 18px',
            background: 'transparent',
            color: c.sub,
            border: `1px solid ${c.soft}`,
            borderRadius: 999,
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 14,
          }}
        >
          ↺
        </button>
      </div>
    </div>
  );
}

export default CodeReady;
