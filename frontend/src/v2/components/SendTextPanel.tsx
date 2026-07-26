import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/lib/api';
import { shareText } from '@/lib/api/share';
import { pushRecent } from '@/lib/recent';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { toast } from '@/components/ui/Toast';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/TurnstileWidget';
import { CodeReadyV2 } from './CodeReadyV2';
import { ExpiryControl, expiryToApi, type ExpiryValue } from './ExpiryControl';
import { panelGrid, panelMain, submitButton } from './panelLayout';
import { Icon } from './IconSprite';

export function SendTextPanel() {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const [text, setText] = useState('');
  const [expiry, setExpiry] = useState<ExpiryValue>({ mode: 'count', days: 7, count: 1 });
  const [code, setCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const gated = Boolean(config.turnstileProtectUpload && config.turnstileSiteKey);

  const submit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    let token: string | undefined;
    try {
      if (gated) {
        token = await turnstileRef.current?.executeAndWaitForToken();
        if (!token) throw new Error(t('v2.send.turnstileRequired'));
      }
      const res = await shareText({ text, ...expiryToApi(expiry), ...(token ? { turnstile_token: token } : {}) });
      pushRecent({
        code: res.code,
        kind: 'text',
        name: t('v2.recent.textShare'),
        size: new Blob([text]).size,
        type: 'text/plain',
        created_at: new Date().toISOString(),
        expires_at: res.expired_at,
      });
      setCode(res.code);
      turnstileRef.current?.reset();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message;
      setError(msg || t('v2.send.failedText'));
      toast.error(msg || t('v2.send.failedText'));
      turnstileRef.current?.reset();
    } finally {
      setSubmitting(false);
    }
  };

  if (code) return <CodeReadyV2 code={code} onReset={() => { setCode(null); setText(''); }} />;

  return (
    <div data-r="two-col" style={panelGrid}>
      <div data-r="panelmain" style={panelMain}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('v2.send.textPlaceholder')}
          style={{ width: '100%', flex: 1, minHeight: 0, padding: '14px 16px', border: '1px solid var(--ln2)', borderRadius: 12, background: 'var(--p2)', color: 'var(--tx1)', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.6, resize: 'vertical', outline: 'none' }}
        />
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--tx3)' }}>
          <span>{t('v2.send.chars', { n: text.length })}</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>UTF-8 · plain</span>
        </div>
        {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--bad)' }}>{error}</div>}
      </div>
      <div>
        <ExpiryControl value={expiry} onChange={setExpiry} />
        {gated && config.turnstileSiteKey && (
          <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}>
            <TurnstileWidget ref={turnstileRef} mode="invisible-on-submit" siteKey={config.turnstileSiteKey} onVerify={() => {}} onExpire={() => {}} onError={() => {}} />
          </div>
        )}
        <button
          type="button"
          data-yd="btn"
          disabled={!text.trim() || submitting}
          onClick={() => void submit()}
          style={{ ...submitButton, opacity: !text.trim() || submitting ? 0.5 : 1, cursor: !text.trim() || submitting ? 'not-allowed' : 'pointer' }}
        >
          {submitting ? t('v2.send.submitting') : t('v2.send.submit')}
          <Icon name="i-arr" size={16} style={{ opacity: 0.85 }} />
        </button>
      </div>
    </div>
  );
}
