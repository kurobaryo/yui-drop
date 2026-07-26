import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/lib/api';
import { pushRecent } from '@/lib/recent';
import { uploadFile, uploadFiles, type StorageBackend } from '@/lib/uploader';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { toast } from '@/components/ui/Toast';
import { TurnstileWidget, type TurnstileWidgetHandle } from '@/components/TurnstileWidget';
import { CodeReadyV2 } from './CodeReadyV2';
import { ExpiryControl, expiryToApi, type ExpiryValue } from './ExpiryControl';
import { panelGrid, panelMain, submitButton, submitButtonWrap } from './panelLayout';
import { Icon } from './IconSprite';
import { haptic } from '../haptics';
import { HapticTap } from './HapticTap';

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

export function SendFilePanel() {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const inputRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [expiry, setExpiry] = useState<ExpiryValue>({ mode: 'date', days: 7, count: 10 });
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gated = Boolean(config.turnstileProtectUpload && config.turnstileSiteKey);

  useEffect(() => () => abortRef.current?.(), []);

  const add = (list: FileList | null) => {
    if (!list?.length) return;
    setFiles(Array.from(list));
    setError(null);
  };

  const submit = async () => {
    if (!files.length || uploading) return;
    setUploading(true); setProgress(0); setError(null);
    let token: string | undefined;
    try {
      if (gated) {
        token = await turnstileRef.current?.executeAndWaitForToken();
        if (!token) throw new Error(t('v2.send.turnstileRequired'));
      }
      const exp = expiryToApi(expiry);
      if (files.length === 1) {
        const f = files[0];
        const h = uploadFile({
          file: f, expireValue: exp.expire_value, expireStyle: exp.expire_style,
          storageBackend: (config.storage_backend ?? 'local') as StorageBackend,
          turnstileToken: token, onProgress: (v) => setProgress(v * 100),
        });
        abortRef.current = h.abort;
        const res = await h.promise;
        pushRecent({ code: res.code, kind: 'file', name: res.name, size: res.size, type: f.type || null, created_at: new Date().toISOString(), expires_at: null });
        setCode(res.code);
      } else {
        const h = uploadFiles({
          files, expireValue: exp.expire_value, expireStyle: exp.expire_style,
          storageBackend: (config.storage_backend ?? 'local') as StorageBackend,
          turnstileToken: token, onOverallProgress: (v) => setProgress(v * 100),
        });
        abortRef.current = h.abort;
        const res = await h.promise;
        pushRecent({ code: res.code, kind: 'multi', name: files[0]?.name, size: null, type: null, fileCount: res.fileCount, totalSize: res.totalSize, created_at: new Date().toISOString(), expires_at: null });
        setCode(res.code);
      }
      haptic('success');
      turnstileRef.current?.reset();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error)?.message;
      haptic('error');
      setError(msg || t('v2.send.failedUpload'));
      toast.error(msg || t('v2.send.failedUpload'));
      turnstileRef.current?.reset();
    } finally {
      abortRef.current = null; setUploading(false);
    }
  };

  if (code) return <CodeReadyV2 code={code} onReset={() => { setCode(null); setFiles([]); setProgress(0); }} />;

  return (
    <div data-r="two-col" style={panelGrid}>
      <div data-r="panelmain" style={panelMain}>
        <div
          data-yd="drop"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); add(e.dataTransfer.files); }}
          style={{ border: '1.5px dashed var(--ln2)', borderRadius: 14, padding: '26px 20px', background: 'linear-gradient(180deg,var(--acs),transparent)', display: 'flex', alignItems: 'center', gap: 18, cursor: 'pointer' }}
        >
          <div style={{ width: 52, height: 52, borderRadius: 15, background: 'var(--ac)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 20px var(--acs)', flexShrink: 0 }}>
            <Icon name="i-up" size={24} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: '-.01em', color: 'var(--tx)' }}>{t('v2.send.dropTitle')}</div>
            <div style={{ marginTop: 3, fontSize: 12.5, color: 'var(--tx3)' }}>{t('v2.send.dropHint', { max: '10 GB' })}</div>
            <div style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(['image','video','pdf','archive'] as const).map((k) => <span key={k} style={tag}>{t(`v2.fileTypes.${k}`)}</span>)}
              <span style={{ fontSize: 11, color: 'var(--tx3)', padding: '2px 4px' }}>{t('v2.send.anyFormat')}</span>
            </div>
          </div>
          <span data-r="hide-sm" style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--act)', border: '1px solid var(--ac)', borderRadius: 10, padding: '9px 14px', whiteSpace: 'nowrap' }}>
            <Icon name="i-plus" size={15} />{t('v2.send.choose')}
          </span>
          <input ref={inputRef} type="file" multiple hidden onChange={(e) => add(e.target.files)} />
        </div>

        {files.length > 0 && <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {files.map((f, i) => <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--ln)', borderRadius: 10, background: 'var(--p2)' }}>
            <Icon name={f.type.startsWith('video/') ? 'i-vid' : f.type.startsWith('image/') ? 'i-img' : 'i-file'} size={18} style={{ color: 'var(--tx3)' }} />
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 14, color: 'var(--tx1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</div><div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: 'var(--tx3)' }}>{size(f.size)}</div></div>
            <button type="button" onClick={() => setFiles((xs) => xs.filter((_, n) => n !== i))} style={iconButton}><Icon name="i-x" size={15} /></button>
          </div>)}
        </div>}

        {(uploading || progress > 0) && <div style={{ marginTop: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--tx3)', marginBottom: 6 }}><span>{t('v2.send.uploadProgress')}</span><span style={{ fontFamily: "'JetBrains Mono',monospace" }}>{Math.round(progress)}%</span></div><div style={{ height: 6, borderRadius: 999, background: 'var(--p1)', overflow: 'hidden' }}><div style={{ width: `${progress}%`, height: '100%', background: 'var(--ac)' }} /></div></div>}
        {error && <div style={{ marginTop: 8, color: 'var(--bad)', fontSize: 12 }}>{error}</div>}
      </div>
      <div>
        <ExpiryControl value={expiry} onChange={setExpiry} />
        {gated && config.turnstileSiteKey && <div style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}><TurnstileWidget ref={turnstileRef} mode="invisible-on-submit" siteKey={config.turnstileSiteKey} onVerify={() => {}} onExpire={() => {}} onError={() => {}} /></div>}
        <HapticTap onTap={() => void submit()} radius={10} disabled={!files.length || uploading} label={t('v2.send.submit')} style={submitButtonWrap}><span data-yd="btn" style={{ ...submitButton, opacity: !files.length || uploading ? .5 : 1, cursor: !files.length || uploading ? 'not-allowed' : 'pointer' }}>{uploading ? t('v2.send.uploading') : t('v2.send.submit')}<Icon name="i-arr" size={16} style={{ opacity: .85 }} /></span></HapticTap>
      </div>
    </div>
  );
}

const tag: React.CSSProperties = { fontSize: 11, color: 'var(--tx2)', background: 'var(--p1)', border: '1px solid var(--ln)', borderRadius: 999, padding: '2px 9px' };
const iconButton: React.CSSProperties = { color: 'var(--tx3)', cursor: 'pointer', border: 0, background: 'transparent', padding: 4 };
