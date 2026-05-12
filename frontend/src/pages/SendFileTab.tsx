/**
 * SendFileTab — drag-and-drop or click-to-pick file uploader.
 *
 * Flow:
 *   1) user picks a file (drag/drop or <input type=file>)
 *   2) pick an expiry style
 *   3) hit Upload → uploadFile() routes to simple / chunked / presigned
 *   4) progress bar updates from the onProgress callback
 *   5) on success show big code + copy + short link + "send another"
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UploadCloud, FileIcon, Copy, RotateCcw, X } from 'lucide-react';
import { uploadFile, type StorageBackend } from '@/lib/uploader';
import { ApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/Toast';
import { pushRecent } from '@/lib/recent';
import { humanBytes, humanSpeed, humanDuration } from '@/lib/format';
import type { ExpireStyle } from '@/lib/api/share';
import { cn } from '@/lib/cn';

interface ExpireChoice {
  value: number;
  style: ExpireStyle;
  labelKey: string;
}

const EXPIRE_CHOICES: ExpireChoice[] = [
  { value: 1, style: 'day', labelKey: 'sendFile.expireDay' },
  { value: 1, style: 'week', labelKey: 'sendFile.expireWeek' },
  { value: 1, style: 'month', labelKey: 'sendFile.expireMonth' },
  { value: 5, style: 'count', labelKey: 'sendFile.expireCount' },
  { value: 0, style: 'forever', labelKey: 'sendFile.expireForever' },
];

export default function SendFileTab() {
  const { t } = useTranslation();
  const config = usePublicConfig();

  const [file, setFile] = useState<File | null>(null);
  const [choiceIdx, setChoiceIdx] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0); // 0–1
  const [speed, setSpeed] = useState<number>(0); // bytes/sec
  const [eta, setEta] = useState<number>(0); // seconds

  const [result, setResult] = useState<{ code: string; name: string; size: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  // Speed/ETA tracking — sample progress at intervals.
  const speedSample = useRef<{ t: number; bytes: number } | null>(null);

  useEffect(() => {
    return () => {
      // On unmount, cancel any in-flight upload.
      abortRef.current?.();
    };
  }, []);

  const onPick = useCallback(
    (f: File | null) => {
      setError(null);
      if (!f) {
        setFile(null);
        return;
      }
      if (f.size > config.max_upload_bytes) {
        setError(
          t('sendFile.tooLarge', {
            max: humanBytes(config.max_upload_bytes),
          }),
        );
        return;
      }
      setFile(f);
    },
    [config.max_upload_bytes, t],
  );

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onPick(f);
  }

  async function startUpload() {
    if (!file || uploading) return;
    const choice = EXPIRE_CHOICES[choiceIdx]!;
    setUploading(true);
    setProgress(0);
    setError(null);
    speedSample.current = { t: performance.now(), bytes: 0 };

    const handle = uploadFile({
      file,
      expireValue: choice.value,
      expireStyle: choice.style,
      storageBackend: (config.storage_backend ?? 'local') as StorageBackend,
      onProgress: (f01) => {
        setProgress(f01);
        const bytesNow = f01 * file.size;
        const now = performance.now();
        const prev = speedSample.current;
        if (prev && now - prev.t > 400) {
          const dt = (now - prev.t) / 1000;
          const db = bytesNow - prev.bytes;
          const bps = db / dt;
          setSpeed(bps);
          const remaining = Math.max(0, file.size - bytesNow);
          setEta(bps > 0 ? remaining / bps : 0);
          speedSample.current = { t: now, bytes: bytesNow };
        }
      },
    });
    abortRef.current = handle.abort;

    try {
      const res = await handle.promise;
      setResult(res);
      pushRecent({
        code: res.code,
        kind: 'file',
        name: res.name,
        size: res.size,
        type: file.type,
        created_at: new Date().toISOString(),
        // Note: server returns expired_at on the share envelope; we don't
        // have it on UploadResult, so leave null. The Recent list will treat
        // it as "forever" until the user retrieves once.
        expires_at: null,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setError('canceled');
      } else if (e instanceof ApiError) {
        setError(e.message || t('retrieve.genericError'));
      } else {
        setError(t('retrieve.genericError'));
      }
    } finally {
      setUploading(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    abortRef.current?.();
  }

  function reset() {
    setFile(null);
    setResult(null);
    setError(null);
    setProgress(0);
    setSpeed(0);
    setEta(0);
    if (inputRef.current) inputRef.current.value = '';
  }

  // ── Success state ────────────────────────────────────────────────────────
  if (result) {
    const shortLink =
      (config.app_url?.replace(/\/$/, '') ||
        (typeof window !== 'undefined' ? window.location.origin : '')) +
      `/s/${result.code}`;
    return (
      <div className="flex flex-col items-center text-center">
        <div className="text-xs uppercase tracking-wider text-[--text-2] mb-2">
          {t('sendFile.code')}
        </div>
        <div className="font-mono text-5xl md:text-6xl font-bold text-[--text-1] tracking-widest">
          {result.code}
        </div>
        <div className="mt-2 text-xs text-[--text-muted]">
          {result.name} · {humanBytes(result.size)}
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button
            size="md"
            variant="outline"
            leftIcon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              const ok = await copyToClipboard(result.code);
              if (ok) toast.success(t('common.copied'));
            }}
          >
            {t('sendFile.copy')}
          </Button>
          <Button
            size="md"
            variant="outline"
            onClick={async () => {
              const ok = await copyToClipboard(shortLink);
              if (ok) toast.success(t('common.copied'));
            }}
          >
            {t('sendFile.link')}
          </Button>
          <Button
            size="md"
            variant="ghost"
            leftIcon={<RotateCcw className="h-4 w-4" />}
            onClick={reset}
          >
            {t('sendFile.another')}
          </Button>
        </div>
        <div className="mt-3 text-xs font-mono text-[--text-muted] break-all">
          {shortLink}
        </div>
      </div>
    );
  }

  // ── Picker / progress state ─────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Hidden input shared by drop zone + "choose another". */}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
      />

      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center',
            'rounded-lg border-2 border-dashed px-6 py-12 text-center',
            'transition-colors duration-150',
            'border-[--border] hover:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
            dragOver &&
              'border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] bg-[--bg-1]',
          )}
        >
          <UploadCloud className="h-8 w-8 text-[--text-2]" />
          <p className="mt-2 text-sm text-[--text-2]">{t('sendFile.drop')}</p>
          <p className="mt-1 text-xs text-[--text-muted]">
            max {humanBytes(config.max_upload_bytes)}
          </p>
        </div>
      ) : (
        <div className="card flex items-center gap-3 p-3">
          <FileIcon className="h-6 w-6 text-[--text-2] shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-[--text-1]">{file.name}</div>
            <div className="text-xs text-[--text-muted]">
              {humanBytes(file.size)} · {file.type || '—'}
            </div>
          </div>
          {!uploading && (
            <button
              type="button"
              onClick={reset}
              aria-label="remove"
              className="rounded p-1 text-[--text-muted] hover:text-[--text-1]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-[--text-2]">{t('sendFile.expire')}</span>
          <Select
            value={choiceIdx}
            onChange={(e) => setChoiceIdx(Number(e.target.value))}
            disabled={uploading}
          >
            {EXPIRE_CHOICES.map((c, i) => (
              <option key={i} value={i}>
                {t(c.labelKey)}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex items-end">
          {uploading ? (
            <Button variant="outline" size="md" onClick={cancel}>
              {t('common.cancel')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              disabled={!file}
              onClick={() => void startUpload()}
            >
              {t('sendFile.upload')}
            </Button>
          )}
        </div>
      </div>

      {uploading && (
        <ProgressBar
          value={progress * 100}
          label={`${(progress * 100).toFixed(0)}% · ${t('sendFile.uploading')}`}
          speed={
            speed > 0
              ? `${humanSpeed(speed)}/s · ETA ${humanDuration(eta)}`
              : undefined
          }
        />
      )}

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
