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
import { rawAxios, api } from './api';
import {
  shareFileMultipart,
  multiInit,
  multiFileInit,
  multiFileComplete,
  multiFinalize,
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
  /** Cloudflare Turnstile token; required only when admin set protect_upload. */
  turnstileToken?: string;
}

// 5 MiB simple-vs-chunked threshold, 1 MiB chunk size for server-proxied.
const SIMPLE_LIMIT = 5 * 1024 * 1024;
const CHUNK_SIZE = 1 * 1024 * 1024;
// S3 multipart minimum is 5 MiB per part except the last.
const PRESIGN_PART_SIZE = 8 * 1024 * 1024;

// ── Dynamic upload limits (loaded once from /api/config/upload) ────────────
//
// The backend exposes the active limits and the chunked-upload kill switch
// via a public endpoint so the browser can preflight a refusal before
// streaming bytes. We cache the response in a module-level promise so the
// first call kicks off the fetch and every later caller reuses the result.

export interface PublicUploadConfig {
  chunk_upload_enabled: boolean;
  simple_upload_max_bytes: number;
  chunk_upload_max_bytes: number;
  multi_total_max_bytes: number;
}

// Generous fallbacks if the endpoint can't be reached — the server is still
// the final authority and will reject anything genuinely oversized.
const FALLBACK_UPLOAD_CONFIG: PublicUploadConfig = {
  chunk_upload_enabled: true,
  simple_upload_max_bytes: SIMPLE_LIMIT,
  chunk_upload_max_bytes: 50 * 1024 * 1024 * 1024,
  multi_total_max_bytes: 50 * 1024 * 1024 * 1024,
};

let _uploadConfigPromise: Promise<PublicUploadConfig> | null = null;

export function getUploadConfig(): Promise<PublicUploadConfig> {
  if (_uploadConfigPromise) return _uploadConfigPromise;
  _uploadConfigPromise = api
    .get<PublicUploadConfig>('/config/upload')
    .then((r) => r.data)
    .catch(() => FALLBACK_UPLOAD_CONFIG);
  return _uploadConfigPromise;
}

function fmtMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(0)} MB`;
}

async function enforceSingleFileLimits(file: File): Promise<void> {
  const cfg = await getUploadConfig();
  if (
    !cfg.chunk_upload_enabled &&
    file.size >= cfg.simple_upload_max_bytes
  ) {
    throw new Error(
      'Large file upload is currently disabled by administrator',
    );
  }
  if (file.size > cfg.chunk_upload_max_bytes) {
    throw new Error(
      `File is too large (max ${fmtMb(cfg.chunk_upload_max_bytes)}).`,
    );
  }
}

async function enforceMultiTotalLimit(files: File[]): Promise<void> {
  const cfg = await getUploadConfig();
  const total = files.reduce((acc, f) => acc + f.size, 0);
  if (total > cfg.multi_total_max_bytes) {
    throw new Error(
      `Total size exceeds the limit (max ${fmtMb(cfg.multi_total_max_bytes)}).`,
    );
  }
  // Apply the per-file ceiling individually too.
  for (const f of files) {
    if (f.size > cfg.chunk_upload_max_bytes) {
      throw new Error(
        `"${f.name}" is too large (max ${fmtMb(cfg.chunk_upload_max_bytes)}).`,
      );
    }
    if (
      !cfg.chunk_upload_enabled &&
      f.size >= cfg.simple_upload_max_bytes
    ) {
      throw new Error(
        'Large file upload is currently disabled by administrator',
      );
    }
  }
}

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
    await enforceSingleFileLimits(opts.file);
    if (strategy === 'simple') {
      const res = await shareFileMultipart(
        opts.file,
        opts.expireValue,
        opts.expireStyle,
        (loaded, total) => opts.onProgress?.(total > 0 ? loaded / total : 0),
        controller.signal,
        opts.turnstileToken ?? null,
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
    turnstile_token: opts.turnstileToken ?? null,
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
    turnstile_token: opts.turnstileToken ?? null,
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

// ─── Multi-file uploader ──────────────────────────────────────────────────

export type UploadFileState = 'pending' | 'uploading' | 'complete' | 'failed';

export interface UploadFilesOptions {
  files: File[];
  expireValue: number;
  expireStyle: ExpireStyle;
  storageBackend: StorageBackend;
  /** Per-file progress (0..1) — called many times per file. */
  onFileProgress?: (index: number, fraction: number) => void;
  /** Overall progress (0..1) computed across all files by total bytes. */
  onOverallProgress?: (fraction: number) => void;
  /** Per-file lifecycle marker. */
  onFileState?: (index: number, state: UploadFileState) => void;
  /** Cloudflare Turnstile token; required only when admin set protect_upload.
   * Sent on the first hop (`/share/multi/init`); subsequent per-file calls
   * are authenticated by the returned `upload_token`. */
  turnstileToken?: string;
}

export interface UploadFilesResult {
  code: string;
  shareId: number;
  fileCount: number;
  totalSize: number;
}

export interface UploadFilesHandle {
  promise: Promise<UploadFilesResult>;
  abort: () => void;
}

const MULTI_CHUNK_SIZE = 1 * 1024 * 1024;

/**
 * Upload N files as a single multi-share.
 *
 * Sequential per-file for v1. Progress is aggregated into both per-file
 * fractions and an overall fraction (weighted by total bytes).
 *
 * presign_payload is null for v1 (backend doesn't issue it yet for the multi
 * flow); we always use the server-proxied chunked path here.
 */
export function uploadFiles(opts: UploadFilesOptions): UploadFilesHandle {
  const controller = new AbortController();
  const abort = () => controller.abort();

  const totalBytes = opts.files.reduce((acc, f) => acc + f.size, 0);

  const run = async (): Promise<UploadFilesResult> => {
    await enforceMultiTotalLimit(opts.files);
    // Mark every file as pending up front so the UI can render the queue.
    for (let i = 0; i < opts.files.length; i++) {
      opts.onFileState?.(i, 'pending');
      opts.onFileProgress?.(i, 0);
    }
    opts.onOverallProgress?.(0);

    const init = await multiInit({
      declared_file_count: opts.files.length,
      declared_total_size: totalBytes,
      expire_value: opts.expireValue,
      expire_style: opts.expireStyle,
      turnstile_token: opts.turnstileToken ?? null,
    });

    let doneTotalBytes = 0;

    for (let i = 0; i < opts.files.length; i++) {
      if (controller.signal.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      const file = opts.files[i]!;
      opts.onFileState?.(i, 'uploading');

      try {
        const fInit = await multiFileInit(init.share_id, init.upload_token, {
          name: file.name,
          size: file.size,
          content_type: file.type || null,
          declared_chunked: true,
          chunk_size: MULTI_CHUNK_SIZE,
        });

        const chunkSize = fInit.chunk_size || MULTI_CHUNK_SIZE;
        const totalChunks = fInit.total_chunks;
        let fileDoneBytes = 0;

        for (let c = 0; c < totalChunks; c++) {
          if (controller.signal.aborted) {
            throw new DOMException('aborted', 'AbortError');
          }
          const start = c * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const blob = file.slice(start, end);
          await chunkPart(
            fInit.upload_id,
            c,
            blob,
            (loaded) => {
              const fileNow = fileDoneBytes + loaded;
              opts.onFileProgress?.(
                i,
                file.size > 0 ? Math.min(1, fileNow / file.size) : 1,
              );
              if (totalBytes > 0) {
                opts.onOverallProgress?.(
                  Math.min(1, (doneTotalBytes + fileNow) / totalBytes),
                );
              }
            },
            controller.signal,
          );
          fileDoneBytes += end - start;
          opts.onFileProgress?.(
            i,
            file.size > 0 ? Math.min(1, fileDoneBytes / file.size) : 1,
          );
          if (totalBytes > 0) {
            opts.onOverallProgress?.(
              Math.min(1, (doneTotalBytes + fileDoneBytes) / totalBytes),
            );
          }
        }

        await multiFileComplete(
          init.share_id,
          fInit.file_id,
          init.upload_token,
          { total_uploaded_bytes: file.size },
        );

        doneTotalBytes += file.size;
        opts.onFileProgress?.(i, 1);
        opts.onFileState?.(i, 'complete');
        if (totalBytes > 0) {
          opts.onOverallProgress?.(Math.min(1, doneTotalBytes / totalBytes));
        }
      } catch (e) {
        opts.onFileState?.(i, 'failed');
        throw e;
      }
    }

    const fin = await multiFinalize(init.share_id, init.upload_token);
    opts.onOverallProgress?.(1);
    return {
      code: fin.code,
      shareId: init.share_id,
      fileCount: fin.file_count,
      totalSize: fin.total_size,
    };
  };

  return { promise: run(), abort };
}
