/**
 * SendFileTab — multi-file drag-and-drop uploader.
 *
 * Flow:
 *   1) user picks one or more files (drag/drop or <input type=file multiple>;
 *      drag-dropped folders are walked via webkitGetAsEntry)
 *   2) pick an expiry style
 *   3) hit Upload → uploadFiles() runs the multi-share orchestration
 *   4) per-file mini progress bars + overall progress bar update live
 *   5) on success show big code + queue summary + copy + short link
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UploadCloud,
  FileIcon,
  Copy,
  RotateCcw,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  uploadFiles,
  type StorageBackend,
  type UploadFileState,
} from '@/lib/uploader';
import { ApiError } from '@/lib/api';
import { usePublicConfig } from '@/lib/hooks/usePublicConfig';
import { Button } from '@/components/ui/Button';
import {
  ExpiryPicker,
  DEFAULT_EXPIRY,
  toExpireRequest,
  type ExpiryValue,
} from '@/components/ui/ExpiryPicker';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/Toast';
import { pushRecent } from '@/lib/recent';
import { humanBytes, humanSpeed, humanDuration } from '@/lib/format';
import { cn } from '@/lib/cn';

const DEFAULT_MAX_FILES = 50;

interface QueueItem {
  id: string;
  file: File;
  progress: number;
  state: UploadFileState;
}

interface MultiResult {
  code: string;
  fileCount: number;
  totalSize: number;
  names: string[];
}

// ─── WebKit FileSystem Entry helpers (folder drop) ───────────────────────

type FsEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (cb: (f: File) => void, errCb?: (e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (cb: (entries: FsEntry[]) => void, errCb?: (e: unknown) => void) => void;
  };
};

async function entryToFiles(entry: FsEntry): Promise<File[]> {
  if (entry.isFile && entry.file) {
    return new Promise<File[]>((resolve) => {
      entry.file!(
        (f) => resolve([f]),
        () => resolve([]),
      );
    });
  }
  if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader();
    // readEntries returns up to ~100 entries per call; loop until empty.
    const allEntries: FsEntry[] = [];
    const readBatch = (): Promise<FsEntry[]> =>
      new Promise((resolve) => {
        reader.readEntries(
          (entries) => resolve(entries),
          () => resolve([]),
        );
      });
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await readBatch();
      if (!batch || batch.length === 0) break;
      allEntries.push(...batch);
    }
    const nested = await Promise.all(allEntries.map(entryToFiles));
    return nested.flat();
  }
  return [];
}

async function collectFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  // Try webkitGetAsEntry first (folder support); fall back to dt.files.
  const items = dt.items;
  if (items && items.length > 0) {
    const anyHasEntry =
      typeof (items[0] as unknown as { webkitGetAsEntry?: () => FsEntry | null })
        .webkitGetAsEntry === 'function';
    if (anyHasEntry) {
      const out: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i] as unknown as {
          webkitGetAsEntry?: () => FsEntry | null;
          getAsFile?: () => File | null;
        };
        const entry = item.webkitGetAsEntry?.();
        if (entry) {
          out.push(...(await entryToFiles(entry)));
        } else {
          const f = item.getAsFile?.();
          if (f) out.push(f);
        }
      }
      return out;
    }
  }
  return Array.from(dt.files ?? []);
}

export default function SendFileTab() {
  const { t } = useTranslation();
  const config = usePublicConfig();

  const maxPerFile = config.max_file_bytes ?? config.max_upload_bytes;
  const maxTotal = config.max_share_total_bytes ?? maxPerFile * 4;
  const maxFiles = config.max_files_per_share ?? DEFAULT_MAX_FILES;

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [expiry, setExpiry] = useState<ExpiryValue>(DEFAULT_EXPIRY);
  const [dragOver, setDragOver] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0); // 0–1
  const [speed, setSpeed] = useState<number>(0); // bytes/sec
  const [eta, setEta] = useState<number>(0); // seconds

  const [result, setResult] = useState<MultiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const speedSample = useRef<{ t: number; bytes: number } | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.();
    };
  }, []);

  const totalSize = queue.reduce((a, q) => a + q.file.size, 0);

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setError(null);
      setQueue((prev) => {
        // De-dupe by (name, size, lastModified).
        const key = (f: File) => `${f.name}::${f.size}::${f.lastModified}`;
        const seen = new Set(prev.map((q) => key(q.file)));
        const fresh = files
          .filter((f) => !seen.has(key(f)))
          .map<QueueItem>((f) => ({
            id: makeId(),
            file: f,
            progress: 0,
            state: 'pending',
          }));
        return [...prev, ...fresh];
      });
    },
    [],
  );

  function removeAt(id: string) {
    if (uploading) return;
    setQueue((prev) => prev.filter((q) => q.id !== id));
  }

  function validate(): string | null {
    if (queue.length === 0) return null;
    if (queue.length > maxFiles) {
      return t('sendFileMulti.tooManyFiles', { max: maxFiles });
    }
    const over = queue.find((q) => q.file.size > maxPerFile);
    if (over) {
      return t('sendFileMulti.fileTooLarge', {
        name: over.file.name,
        max: humanBytes(maxPerFile),
      });
    }
    if (totalSize > maxTotal) {
      return t('sendFileMulti.totalTooLarge', {
        max: humanBytes(maxTotal),
      });
    }
    return null;
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    void (async () => {
      const files = await collectFromDataTransfer(e.dataTransfer);
      addFiles(files);
    })();
  }

  async function startUpload() {
    if (uploading || queue.length === 0) return;
    const valErr = validate();
    if (valErr) {
      setError(valErr);
      return;
    }
    const exp = toExpireRequest(expiry);
    setUploading(true);
    setOverallProgress(0);
    setError(null);
    speedSample.current = { t: performance.now(), bytes: 0 };

    // Snapshot the files we're sending — the queue can't change during upload,
    // but we capture the order explicitly.
    const filesSnapshot = queue.map((q) => q.file);
    const totalBytes = filesSnapshot.reduce((a, f) => a + f.size, 0);

    const handle = uploadFiles({
      files: filesSnapshot,
      expireValue: exp.expire_value,
      expireStyle: exp.expire_style,
      storageBackend: (config.storage_backend ?? 'local') as StorageBackend,
      onFileProgress: (idx, f01) => {
        setQueue((prev) =>
          prev.map((q, i) => (i === idx ? { ...q, progress: f01 } : q)),
        );
      },
      onFileState: (idx, state) => {
        setQueue((prev) =>
          prev.map((q, i) => (i === idx ? { ...q, state } : q)),
        );
      },
      onOverallProgress: (f01) => {
        setOverallProgress(f01);
        const bytesNow = f01 * totalBytes;
        const now = performance.now();
        const prev = speedSample.current;
        if (prev && now - prev.t > 400) {
          const dt = (now - prev.t) / 1000;
          const db = bytesNow - prev.bytes;
          const bps = db / dt;
          setSpeed(bps);
          const remaining = Math.max(0, totalBytes - bytesNow);
          setEta(bps > 0 ? remaining / bps : 0);
          speedSample.current = { t: now, bytes: bytesNow };
        }
      },
    });
    abortRef.current = handle.abort;

    try {
      const res = await handle.promise;
      const names = filesSnapshot.map((f) => f.name);
      setResult({
        code: res.code,
        fileCount: res.fileCount,
        totalSize: res.totalSize,
        names,
      });
      pushRecent({
        code: res.code,
        kind: 'multi',
        name: names[0] ?? null,
        size: null,
        type: null,
        fileCount: res.fileCount,
        totalSize: res.totalSize,
        created_at: new Date().toISOString(),
        expires_at: null,
      });
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        setError(t('common.cancel'));
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
    setQueue([]);
    setResult(null);
    setError(null);
    setOverallProgress(0);
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
    const isMulti = result.fileCount > 1;
    return (
      <div className="flex flex-col items-center text-center">
        <div className="text-xs uppercase tracking-wider text-[--text-2] mb-2">
          {t('sendFile.code')}
        </div>
        <div className="font-mono text-5xl md:text-6xl font-bold text-[--text-1] tracking-widest">
          {result.code}
        </div>
        <div className="mt-2 text-xs text-[--text-muted]">
          {isMulti
            ? t('sendFileMulti.summary', {
                n: result.fileCount,
                size: humanBytes(result.totalSize),
              })
            : `${result.names[0] ?? ''} · ${humanBytes(result.totalSize)}`}
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
        {isMulti && (
          <div className="mt-5 w-full max-w-md text-left">
            <div className="mb-2 text-xs uppercase tracking-wider text-[--text-2]">
              {t('sendFileMulti.uploadedFiles')}
            </div>
            <ul className="divide-y divide-[--border] rounded-lg border border-[--border] bg-[--bg-1]">
              {result.names.map((n, i) => (
                <li
                  key={`${i}-${n}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm"
                >
                  <FileIcon className="h-3.5 w-3.5 shrink-0 text-[--text-muted]" />
                  <span className="truncate text-[--text-1]">{n}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // ── Picker / queue / progress state ─────────────────────────────────────
  const valErr = validate();
  return (
    <div className="flex flex-col gap-4">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          addFiles(files);
          // Allow picking the same file twice in a row.
          if (inputRef.current) inputRef.current.value = '';
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!uploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => {
          if (!uploading) inputRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (uploading) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center',
          'rounded-lg border-2 border-dashed px-6 py-10 text-center',
          'transition-colors duration-150',
          'border-[--border] hover:border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
          dragOver &&
            'border-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] bg-[--bg-1]',
          uploading && 'pointer-events-none opacity-60',
        )}
      >
        <UploadCloud className="h-7 w-7 text-[--text-2]" />
        <p className="mt-2 text-sm text-[--text-2]">
          {t('sendFileMulti.drop')}
        </p>
        <p className="mt-1 text-xs text-[--text-muted]">
          {t('sendFileMulti.maxHint', {
            perFile: humanBytes(maxPerFile),
            total: humanBytes(maxTotal),
            count: maxFiles,
          })}
        </p>
      </div>

      {queue.length > 0 && (
        <div className="rounded-lg border border-[--border] bg-[--bg-1]">
          <div className="flex items-center justify-between border-b border-[--border] px-3 py-2 text-xs text-[--text-2]">
            <span>
              {t('sendFileMulti.summary', {
                n: queue.length,
                size: humanBytes(totalSize),
              })}
            </span>
            {!uploading && queue.length > 0 && (
              <button
                type="button"
                onClick={reset}
                className="text-[--text-muted] hover:text-[--text-1]"
              >
                {t('sendFileMulti.clearQueue')}
              </button>
            )}
          </div>
          <ul className="divide-y divide-[--border]">
            {queue.map((q) => (
              <li
                key={q.id}
                className="flex items-center gap-3 px-3 py-2 text-sm"
              >
                <FileIcon className="h-4 w-4 shrink-0 text-[--text-muted]" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[--text-1]">
                      {q.file.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-[--text-muted]">
                      {humanBytes(q.file.size)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-[--bg-2]">
                      <div
                        className="h-full transition-[width] duration-200 ease-out"
                        style={{
                          width: `${Math.round(q.progress * 100)}%`,
                          background:
                            q.state === 'failed'
                              ? 'rgb(248, 113, 113)'
                              : 'hsl(var(--accent-h) var(--accent-s) var(--accent-l))',
                        }}
                      />
                    </div>
                    <StateBadge state={q.state} />
                  </div>
                </div>
                {!uploading && (
                  <button
                    type="button"
                    onClick={() => removeAt(q.id)}
                    aria-label="remove"
                    className="rounded p-1 text-[--text-muted] hover:text-[--text-1]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto]">
        <ExpiryPicker
          value={expiry}
          onChange={setExpiry}
          disabled={uploading}
        />
        <div className="flex items-end">
          {uploading ? (
            <Button variant="outline" size="md" onClick={cancel}>
              {t('common.cancel')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              disabled={queue.length === 0 || !!valErr}
              onClick={() => void startUpload()}
            >
              {t('sendFile.upload')}
            </Button>
          )}
        </div>
      </div>

      {uploading && (
        <ProgressBar
          value={overallProgress * 100}
          label={`${(overallProgress * 100).toFixed(0)}% · ${t('sendFile.uploading')}`}
          speed={
            speed > 0
              ? `${humanSpeed(speed)}/s · ETA ${humanDuration(eta)}`
              : undefined
          }
        />
      )}

      {(error || valErr) && (
        <p className="text-sm text-red-400" role="alert">
          {error ?? valErr}
        </p>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: UploadFileState }) {
  const base =
    'inline-flex h-5 w-5 items-center justify-center rounded-full shrink-0';
  if (state === 'complete') {
    return (
      <span className={cn(base, 'text-emerald-400')} title="complete">
        <CheckCircle2 className="h-4 w-4" />
      </span>
    );
  }
  if (state === 'failed') {
    return (
      <span className={cn(base, 'text-red-400')} title="failed">
        <AlertCircle className="h-4 w-4" />
      </span>
    );
  }
  if (state === 'uploading') {
    return (
      <span
        className={cn(
          base,
          'text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
        )}
        title="uploading"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      </span>
    );
  }
  return (
    <span
      className={cn(base, 'text-[--text-muted]')}
      title="pending"
      aria-hidden
    >
      <span className="h-2 w-2 rounded-full bg-[--text-muted]" />
    </span>
  );
}
