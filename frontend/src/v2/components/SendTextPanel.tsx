import { useRef, useState } from 'react';

import { ApiError } from '@/lib/api';
import { shareText } from '@/lib/api/share';
import { pushRecent } from '@/lib/recent';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { toast } from '@/components/ui/Toast';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/TurnstileWidget';
import { CodeReadyV2 } from './CodeReadyV2';
import { ExpiryControl, expiryToApi, type ExpiryValue } from './ExpiryControl';
import { Icon } from './IconSprite';

export function SendTextPanel() {
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
        if (!token) throw new Error('请先完成人机验证');
      }
      const res = await shareText({ text, ...expiryToApi(expiry), ...(token ? { turnstile_token: token } : {}) });
      pushRecent({
        code: res.code,
        kind: 'text',
        name: '文字分享',
        size: new Blob([text]).size,
        type: 'text/plain',
        created_at: new Date().toISOString(),
        expires_at: res.expired_at,
      });
      setCode(res.code);
      turnstileRef.current?.reset();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message;
      setError(msg || '发送失败，请稍后重试');
      toast.error(msg || '发送失败，请稍后重试');
      turnstileRef.current?.reset();
    } finally {
      setSubmitting(false);
    }
  };

  if (code) return <CodeReadyV2 code={code} onReset={() => { setCode(null); setText(''); }} />;

  return (
    <div data-r="two-col" style={{ padding: '26px 22px 24px', display: 'grid', gridTemplateColumns: '1fr 300px', gap: 30, alignItems: 'start' }}>
      <div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="在这里输入或粘贴文字…"
          style={{ width: '100%', minHeight: 220, padding: '14px 16px', border: '1px solid var(--ln2)', borderRadius: 12, background: 'var(--p2)', color: 'var(--tx1)', fontFamily: 'inherit', fontSize: 15, lineHeight: 1.6, resize: 'vertical', outline: 'none' }}
        />
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--tx3)' }}>
          <span>{text.length} 字符</span>
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
          {submitting ? '生成中…' : '生成取件码'}
          <Icon name="i-arr" size={16} style={{ opacity: 0.85 }} />
        </button>
      </div>
    </div>
  );
}

const submitButton: React.CSSProperties = {
  width: '100%', height: 48, marginTop: 14, border: 'none', borderRadius: 10,
  background: 'var(--ac)', color: '#fff', fontFamily: 'inherit', fontSize: 15,
  fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
};
