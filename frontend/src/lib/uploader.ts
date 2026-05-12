/**
 * High-level upload dispatcher.
 *
 * Picks one of three strategies depending on file size and storage backend:
 *   1) simple    — POST /api/share/file (FormData) for small files
 *   2) chunked   — server-proxied chunk init/part/complete (default for >= 5 MiB)
 *   3) presigned — S3 multipart with browser-direct part PUTs (when backend == s3)
 *
 * All three resolve to a uniform { code, name, size } envelope and report
 * progress via a single `onProgress(percent01)` callback (0..1).
 */
import { rawAxios } from './api';
import {
  shareFileMultipart,
  type ExpireStyle,
  type ShareFileResponse,
} from './api/share';
import {
  chunkInit,
  chunkPart,
  chunkComplete,
  chunkCancel,
} from './api/chunk';
import {
  presignInit,
  presignSignPart,
  presignComplete,
  presignCancel,
  type PresignCompletePart,
} from './api/presign';

export type StorageBackend = 'local' | 's3' | 'onedrive' | 'webdav';

export interface UploadResult {
  code: string;
  name: string;
  size: number;
}

export interface UploadHandle {
  /** Resolves with the final pickup code + filename + size. */
  promise: Promise<UploadResult>;
  /** Cancel cooperatively (aborts in-flight HTTP and the server session). */
  abort: () => void;
}

export interface UploadOptions {
  file: File;
  expireValue: number;
  expireStyle: ExpireStyle;
  storageBackend: StorageBackend;
  /** Fired with fraction in [0, 1]. */
  onProgress?: (fraction: number) => void;
}

// 5 MiB simple-vs-chunked threshold, 1 MiB chunk size for server-proxied.
const SIMPLE_LIMIT = 5 * 1024 * 1024;
const CHUNK_SIZE = 1 * 1024 * 1024;
// S3 multipart minimum is 5 MiB per part except the last.
const PRESIGN_PART_SIZE = 8 * 1024 * 1024;

function pickStrategy(
  file: File,
  backend: StorageBackend,
): 'simple' | 'chunked' | 'presigned' {
  if (file.size < SIMPLE_LIMIT) return 'simple';
  if (backend === 's3') return 'presigned';
  return 'chunked';
}

export function uploadFile(opts: UploadOptions): UploadHandle {
  const controller = new AbortController();
  const strategy = pickStrategy(opts.file, opts.storageBackend);

  let cancelExtra: (() => void) | null = null;
  const abort = () => {
    controller.abort();
    if (cancelExtra) {
      try {
        cancelExtra();
      } catch {
        /* swallow */
      }
    }
  };

  const run = async (): Promise<UploadResult> => {
    if (strategy === 'simple') {
      const res = await shareFileMultipart(
        opts.file,
        opts.expireValue,
        opts.expireStyle,
        (loaded, total) => opts.onProgress?.(total > 0 ? loaded / total : 0),
        controller.signal,
      );
      return resultFromShare(res);
    }

    if (strategy === 'chunked') {
      return await runChunked(opts, controller.signal, (uid) => {
        cancelExtra = () => void chunkCancel(uid);
      });
    }

    return await runPresigned(opts, controller.signal, (uid) => {
      cancelExtra = () => void presignCancel(uid);
    });
  };

  return { promise: run(), abort };
}

function resultFromShare(r: ShareFileResponse): UploadResult {
  return { code: r.code, name: r.name, size: r.size };
}

// ── Chunked (server-proxied) ──────────────────────────────────────────────
async function runChunked(
  opts: UploadOptions,
  signal: AbortSignal,
  onSession: (uploadId: string) => void,
): Promise<UploadResult> {
  const init = await chunkInit({
    file_name: opts.file.name,
    file_size: opts.file.size,
    chunk_size: CHUNK_SIZE,
    content_type: opts.file.type || null,
    expire_value: opts.expireValue,
    expire_style: opts.expireStyle,
  });
  onSession(init.upload_id);
  const total = init.total_chunks;
  const already = new Set<number>(init.uploaded_chunks);

  let doneBytes = already.size * CHUNK_SIZE;
  const totalBytes = opts.file.size;

  for (let i = 0; i < total; i++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (already.has(i)) continue;
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, opts.file.size);
    const blob = opts.file.slice(start, end);
    await chunkPart(
      init.upload_id,
      i,
      blob,
      (loaded) => {
        const cur = doneBytes + loaded;
        opts.onProgress?.(Math.min(1, cur / totalBytes));
      },
      signal,
    );
    doneBytes += end - start;
    opts.onProgress?.(Math.min(1, doneBytes / totalBytes));
  }

  const done = await chunkComplete(
    init.upload_id,
    opts.expireValue,
    opts.expireStyle,
  );
  return { code: done.code, name: done.name, size: done.size };
}

// ── S3 / R2 multipart (browser → bucket) ──────────────────────────────────
async function runPresigned(
  opts: UploadOptions,
  signal: AbortSignal,
  onSession: (uploadId: string) => void,
): Promise<UploadResult> {
  // The server picks the part size when it knows what's sensible; we hint
  // PRESIGN_PART_SIZE in case it falls back to whatever client suggests.
  const init = await presignInit({
    file_name: opts.file.name,
    file_size: opts.file.size,
    content_type: opts.file.type || null,
    expire_value: opts.expireValue,
    expire_style: opts.expireStyle,
  });
  onSession(init.upload_id);

  const partSize = init.part_size || PRESIGN_PART_SIZE;
  const total = init.parts_total;
  const parts: PresignCompletePart[] = [];
  const rax = rawAxios();
  let doneBytes = 0;

  for (let i = 1; i <= total; i++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const signed = await presignSignPart(init.upload_id, i);
    const start = (i - 1) * partSize;
    const end = Math.min(start + partSize, opts.file.size);
    const blob = opts.file.slice(start, end);

    const resp = await rax.put(signed.url, blob, {
      headers: signed.headers,
      signal,
      onUploadProgress: (e) => {
        const cur = doneBytes + e.loaded;
        opts.onProgress?.(Math.min(1, cur / opts.file.size));
      },
    });
    const etag = (resp.headers?.etag as string | undefined) ?? '';
    parts.push({ part_number: i, etag: etag.replace(/"/g, '') });
    doneBytes += end - start;
    opts.onProgress?.(Math.min(1, doneBytes / opts.file.size));
  }

  const done = await presignComplete(init.upload_id, parts);
  return { code: done.code, name: done.name, size: done.size };
}
