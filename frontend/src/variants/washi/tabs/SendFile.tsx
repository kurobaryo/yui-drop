/**
 * SendFile tab — drop zone + queue + expiry + Forge button.
 *
 * The design's UX is single-file (one drop, one code). We accept multiple
 * files since the design's file input has `multiple`. On submit:
 *   - exactly 1 file  → `shareFileMultipart` (FormData POST)
 *   - 2+ files        → `uploadFiles` (multi-share orchestration)
 * Both paths feed the same `CodeReady` success view.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadFile, uploadFiles, type StorageBackend } from '@/lib/uploader';
import { ApiError } from '@/lib/api';
import { pushRecent } from '@/lib/recent';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { toast } from '@/components/ui/Toast';
import {
  TurnstileWidget,
  type TurnstileWidgetHandle,
} from '@/components/TurnstileWidget';
import type { WashiColors } from '../palettes';
import { Expiry } from '../parts/Expiry';
import { Progress } from '../parts/Progress';
import { CodeReady } from '../parts/CodeReady';
import { expiryToApi, fmtSize, type WashiExpiry } from '../utils';

export interface SendFileProps {
  c: WashiColors;
}

type Stage = 'idle' | 'uploading' | 'done' | 'error';

export function SendFile({ c }: SendFileProps) {
  const { t } = useTranslation();
  const config = usePublicConfig();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<File[]>([]);
  const [expiry, setExpiry] = useState<WashiExpiry>({ mode: 'date', days: 7, count: 10 });
  const [stage, setStage] = useState<Stage>('idle');
  const [progress, setProgress] = useState(0); // 0..100
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileWidgetHandle | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const turnstileGated = Boolean(
          config.turnstileProtectUpload &&
      config.turnstileSiteKey,
  );

  const resetTurnstile = () => {
    setTurnstileToken(null);
    turnstileRef.current?.reset();
  };

  useEffect(() => () => abortRef.current?.(), []);

  const handleFiles = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list);
    if (!arr.length) return;
    setFiles(arr);
    setError(null);
  };

  const onForge = async () => {
    if (!files.length || stage === 'uploading') return;
    if (turnstileGated && !turnstileToken) {
      toast.error(t('turnstile.required'));
      return;
    }
    const { expire_value, expire_style } = expiryToApi(expiry);
    setStage('uploading');
    setProgress(0);
    setError(null);

    try {
      if (files.length === 1) {
        const f = files[0]!;
        // Route through the strategy picker so files above the simple-upload
        // threshold use R2 presigned direct upload (or server-proxied chunked
        // when the backend isn't S3). A single oversized multipart POST would
        // either time out at the reverse proxy or never report progress.
        const handle = uploadFile({
          file: f,
          expireValue: expire_value,
          expireStyle: expire_style,
          storageBackend: (config.storage_backend ?? 'local') as StorageBackend,
          onProgress: (frac) => setProgress(frac * 100),
          turnstileToken: turnstileToken ?? undefined,
        });
        abortRef.current = handle.abort;
        const res = await handle.promise;
        pushRecent({
          code: res.code,
          kind: 'file',
          name: res.name,
          size: res.size,
          type: f.type || null,
          created_at: new Date().toISOString(),
          expires_at: null,
        });
        setCode(res.code);
        setStage('done');
      } else {
        const handle = uploadFiles({
          files,
          expireValue: expire_value,
          expireStyle: expire_style,
          storageBackend: (config.storage_backend ?? 'local') as StorageBackend,
          onOverallProgress: (f01) => setProgress(f01 * 100),
          turnstileToken: turnstileToken ?? undefined,
        });
        abortRef.current = handle.abort;
        const res = await handle.promise;
        pushRecent({
          code: res.code,
          kind: 'multi',
          name: files[0]?.name ?? null,
          size: null,
          type: null,
          fileCount: res.fileCount,
          totalSize: res.totalSize,
          created_at: new Date().toISOString(),
          expires_at: null,
        });
        setCode(res.code);
        setStage('done');
      }
      // Single-use token consumed; clear in case the user sends another.
      resetTurnstile();
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 4003) {
          toast.error(t('turnstile.failed'));
          resetTurnstile();
        }
        setError(e.message || t('washi.notFound'));
      } else {
        setError((e as Error)?.message || t('washi.notFound'));
      }
      setStage('error');
    } finally {
      abortRef.current = null;
    }
  };

  const onReset = () => {
    setCode(null);
    setFiles([]);
    setStage('idle');
    setProgress(0);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  if (code) {
    return <CodeReady c={c} code={code} expiry={expiry} onReset={onReset} />;
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
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          style={{
            border: `1.5px dashed ${c.soft}`,
            borderRadius: 10,
            padding: '40px 24px',
            cursor: 'pointer',
            background: `${c.accent}06`,
            textAlign: 'center',
            transition: 'all .15s',
            flex: files.length ? '0 0 auto' : '1 1 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: files.length ? 0 : 180,
          }}
        >
          <div style={{ fontSize: 32, color: c.accent, marginBottom: 12 }}>＋</div>
          <div style={{ fontSize: 15, color: c.ink }}>{t('washi.dropFiles')}</div>
          <div style={{ fontSize: 12, color: c.sub, marginTop: 6 }}>{t('washi.sizeLimit')}</div>
          <input
            ref={fileRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {files.map((f, i) => (
              <div
                key={`${f.name}-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 14px',
                  border: `1px solid ${c.soft}`,
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 4,
                    background: `${c.accent}20`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: c.accent,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  {(f.name.split('.').pop() ?? '').slice(0, 3).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {f.name}
                  </div>
                  <div style={{ fontSize: 11, color: c.sub }}>{fmtSize(f.size)}</div>
                </div>
                {stage === 'idle' && (
                  <button
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: c.sub,
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {stage === 'uploading' && <Progress c={c} progress={progress} />}
        {stage === 'error' && error && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#c44a3e' }}>{error}</div>
        )}
      </div>

      <div>
        <Expiry c={c} expiry={expiry} setExpiry={setExpiry} />
        {turnstileGated && config.turnstileSiteKey && (
          <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
            <TurnstileWidget
              ref={turnstileRef}
              siteKey={config.turnstileSiteKey}
              onVerify={(token) => setTurnstileToken(token)}
              onExpire={() => setTurnstileToken(null)}
              onError={() => setTurnstileToken(null)}
            />
          </div>
        )}
        {(() => {
          const canSubmit =
            !!files.length &&
            stage !== 'uploading' &&
            (!turnstileGated || !!turnstileToken);
          return (
            <button
              onClick={() => void onForge()}
              disabled={!canSubmit}
              style={{
                marginTop: 20,
                width: '100%',
                padding: '14px 18px',
                background: canSubmit ? c.accent : c.soft,
                color: canSubmit ? c.paper : c.sub,
                border: 'none',
                borderRadius: 8,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: 'inherit',
                fontWeight: 600,
                fontSize: 15,
              }}
            >
              {stage === 'uploading' ? t('washi.forging') : `${t('washi.forge')}  →`}
            </button>
          );
        })()}
      </div>
    </div>
  );
}

export default SendFile;
