/**
 * SendText tab — textarea + expiry + Forge button. Wires to `shareText`.
 *
 * Design quirk worth preserving: the SendText panel defaults to
 * `{ mode: 'count', count: 1 }` (a single-pickup text drop), unlike SendFile
 * which defaults to 7-day expiry.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { shareText } from '@/lib/api/share';
import { ApiError } from '@/lib/api';
import { pushRecent } from '@/lib/recent';
import type { WashiColors } from '../palettes';
import { Expiry } from '../parts/Expiry';
import { CodeReady } from '../parts/CodeReady';
import { expiryToApi, type WashiExpiry } from '../utils';

export function SendText({ c }: { c: WashiColors }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [expiry, setExpiry] = useState<WashiExpiry>({ mode: 'count', days: 7, count: 1 });
  const [code, setCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!text || submitting) return;
    const { expire_value, expire_style } = expiryToApi(expiry);
    setSubmitting(true);
    setError(null);
    try {
      const res = await shareText({ text, expire_value, expire_style });
      pushRecent({
        code: res.code,
        kind: 'text',
        name: null,
        size: new Blob([text]).size,
        type: 'text/plain',
        created_at: new Date().toISOString(),
        expires_at: res.expired_at,
      });
      setCode(res.code);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message || t('washi.notFound'));
      else setError((e as Error)?.message || t('washi.notFound'));
    } finally {
      setSubmitting(false);
    }
  };

  if (code) {
    return (
      <CodeReady
        c={c}
        code={code}
        expiry={expiry}
        onReset={() => {
          setCode(null);
          setText('');
        }}
      />
    );
  }

  return (
    <div
      data-yui="two-col"
      style={{
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: 28,
        alignItems: 'stretch',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('washi.typeHere')}
          style={{
            width: '100%',
            flex: 1,
            minHeight: 220,
            padding: '16px 18px',
            border: `1px solid ${c.soft}`,
            borderRadius: 10,
            background: 'transparent',
            color: c.ink,
            fontFamily: 'inherit',
            fontSize: 15,
            lineHeight: 1.6,
            resize: 'none',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: c.sub,
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>{text.length} chars</span>
          <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>UTF-8 · plain</span>
        </div>
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#c44a3e' }}>{error}</div>
        )}
      </div>
      <div>
        <Expiry c={c} expiry={expiry} setExpiry={setExpiry} />
        <button
          onClick={() => void submit()}
          disabled={!text || submitting}
          style={{
            marginTop: 20,
            width: '100%',
            padding: '14px 18px',
            background: text && !submitting ? c.accent : c.soft,
            color: text && !submitting ? c.paper : c.sub,
            border: 'none',
            borderRadius: 8,
            cursor: text && !submitting ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          {submitting ? t('washi.forging') : `${t('washi.forge')}  →`}
        </button>
      </div>
    </div>
  );
}

export default SendText;
