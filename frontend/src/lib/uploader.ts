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
import {
  collectionFileInit,
  collectionFileSignPart,
  collectionFilePart,
  collectionFileComplete,
} from './api/collection';

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
      return await runChunked(
        opts.file,
        shareChunkedTransport(opts),
        opts.onProgress,
        controller.signal,
        (uid) => {
          cancelExtra = () => void chunkCancel(uid);
        },
      );
    }

    return await runPresigned(
      opts.file,
      sharePresignedTransport(opts),
      opts.onProgress,
      controller.signal,
      (uid) => {
        cancelExtra = () => void presignCancel(uid);
      },
    );
  };

  return { promise: run(), abort };
}

function resultFromShare(r: ShareFileResponse): UploadResult {
  return { code: r.code, name: r.name, size: r.size };
}

// ── Transport adapters ────────────────────────────────────────────────────
//
// `runChunked` / `runPresigned` are strategy implementations. The original
// single-share path used the `/api/chunk/*` and `/api/presign/*` URLs; the
// collection feature reuses the SAME loop but talks to `/api/collections/*`.
//
// We expose adapter interfaces so the multipart loops never bake in URLs.
// Both adapters return identical result shapes — `code`/`name`/`size` for
// the single-share path, a synthetic `code` for the collection path (the
// collection's room code) plus the inserted file id surfaced via `onFileId`.

interface ChunkedTransport {
  /** POST init → returns the upload id, total chunks, and any chunks the
   * server already has on a resume. */
  init: () => Promise<{
    upload_id: string;
    total_chunks: number;
    uploaded_chunks: number[];
  }>;
  part: (
    uploadId: string,
    chunkIndex: number,
    blob: Blob,
    onProgress: (loaded: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  complete: (uploadId: string) => Promise<UploadResult>;
  cancel: (uploadId: string) => Promise<void>;
}

interface PresignedTransport {
  init: () => Promise<{
    upload_id: string;
    part_size: number;
    parts_total: number;
  }>;
  signPart: (
    uploadId: string,
    partNumber: number,
  ) => Promise<{ url: string; headers: Record<string, string> }>;
  complete: (
    uploadId: string,
    parts: PresignCompletePart[],
  ) => Promise<UploadResult>;
  cancel: (uploadId: string) => Promise<void>;
}

// ── Single-share transport adapters ────────────────────────────────────────
//
// Thin wrappers over the existing /api/chunk + /api/presign helpers so the
// shared loops can stay URL-agnostic.

function shareChunkedTransport(opts: UploadOptions): ChunkedTransport {
  return {
    init: async () => {
      const r = await chunkInit({
        file_name: opts.file.name,
        file_size: opts.file.size,
        chunk_size: CHUNK_SIZE,
        content_type: opts.file.type || null,
        expire_value: opts.expireValue,
        expire_style: opts.expireStyle,
        turnstile_token: opts.turnstileToken ?? null,
      });
      return {
        upload_id: r.upload_id,
        total_chunks: r.total_chunks,
        uploaded_chunks: r.uploaded_chunks,
      };
    },
    part: (uploadId, idx, blob, onProgress, signal) =>
      chunkPart(uploadId, idx, blob, (loaded) => onProgress(loaded), signal),
    complete: async (uploadId) => {
      const r = await chunkComplete(
        uploadId,
        opts.expireValue,
        opts.expireStyle,
      );
      return { code: r.code, name: r.name, size: r.size };
    },
    cancel: (uploadId) => chunkCancel(uploadId),
  };
}

function sharePresignedTransport(opts: UploadOptions): PresignedTransport {
  return {
    init: async () => {
      const r = await presignInit({
        file_name: opts.file.name,
        file_size: opts.file.size,
        content_type: opts.file.type || null,
        expire_value: opts.expireValue,
        expire_style: opts.expireStyle,
        turnstile_token: opts.turnstileToken ?? null,
      });
      return {
        upload_id: r.upload_id,
        part_size: r.part_size,
        parts_total: r.parts_total,
      };
    },
    signPart: async (uploadId, partNumber) => {
      const r = await presignSignPart(uploadId, partNumber);
      return { url: r.url, headers: r.headers };
    },
    complete: async (uploadId, parts) => {
      const r = await presignComplete(uploadId, parts);
      return { code: r.code, name: r.name, size: r.size };
    },
    cancel: (uploadId) => presignCancel(uploadId),
  };
}

// ── Chunked (server-proxied) ──────────────────────────────────────────────
async function runChunked(
  file: File,
  transport: ChunkedTransport,
  onProgress: ((fraction: number) => void) | undefined,
  signal: AbortSignal,
  onSession: (uploadId: string) => void,
): Promise<UploadResult> {
  const init = await transport.init();
  onSession(init.upload_id);
  const total = init.total_chunks;
  const already = new Set<number>(init.uploaded_chunks);

  let doneBytes = already.size * CHUNK_SIZE;
  const totalBytes = file.size;

  for (let i = 0; i < total; i++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (already.has(i)) continue;
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);
    await transport.part(
      init.upload_id,
      i,
      blob,
      (loaded) => {
        const cur = doneBytes + loaded;
        onProgress?.(Math.min(1, cur / totalBytes));
      },
      signal,
    );
    doneBytes += end - start;
    onProgress?.(Math.min(1, doneBytes / totalBytes));
  }

  return await transport.complete(init.upload_id);
}

// ── S3 / R2 multipart (browser → bucket) ──────────────────────────────────
async function runPresigned(
  file: File,
  transport: PresignedTransport,
  onProgress: ((fraction: number) => void) | undefined,
  signal: AbortSignal,
  onSession: (uploadId: string) => void,
): Promise<UploadResult> {
  // The server picks the part size when it knows what's sensible; we hint
  // PRESIGN_PART_SIZE in case it falls back to whatever client suggests.
  const init = await transport.init();
  onSession(init.upload_id);

  const partSize = init.part_size || PRESIGN_PART_SIZE;
  const total = init.parts_total;
  const parts: PresignCompletePart[] = [];
  const rax = rawAxios();
  let doneBytes = 0;

  for (let i = 1; i <= total; i++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const signed = await transport.signPart(init.upload_id, i);
    const start = (i - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);

    const resp = await rax.put(signed.url, blob, {
      headers: signed.headers,
      signal,
      onUploadProgress: (e) => {
        const cur = doneBytes + e.loaded;
        onProgress?.(Math.min(1, cur / file.size));
      },
    });
    const etag = (resp.headers?.etag as string | undefined) ?? '';
    parts.push({ part_number: i, etag: etag.replace(/"/g, '') });
    doneBytes += end - start;
    onProgress?.(Math.min(1, doneBytes / file.size));
  }

  return await transport.complete(init.upload_id, parts);
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

// ─── Collection (共享空间) uploader ────────────────────────────────────────
//
// Same chunked + presigned strategies as the single-share path; the only
// thing that changes is the URL surface. We instantiate transport adapters
// pointed at `/api/collections/{code}/files/*` and feed them into the same
// `runChunked` / `runPresigned` loops.

export interface CollectionUploadedFile {
  fileId: number;
  name: string;
  size: number;
}

export interface UploadFilesToCollectionOptions {
  collectionCode: string;
  memberToken: string;
  files: File[];
  storageBackend: StorageBackend;
  /** Per-file progress (0..1). */
  onFileProgress?: (index: number, fraction: number) => void;
  /** Overall progress across all files (weighted by bytes). */
  onOverallProgress?: (fraction: number) => void;
  /** Lifecycle marker per file (pending → uploading → complete | failed). */
  onFileState?: (index: number, state: UploadFileState) => void;
}

export interface UploadFilesToCollectionResult {
  files: CollectionUploadedFile[];
}

export interface UploadFilesToCollectionHandle {
  promise: Promise<UploadFilesToCollectionResult>;
  abort: () => void;
}

const COLLECTION_CHUNK_SIZE = 1 * 1024 * 1024;

function collectionChunkedTransport(
  code: string,
  memberToken: string,
  file: File,
): ChunkedTransport & { getFileId: () => number | null } {
  let lastFileId: number | null = null;
  return {
    init: async () => {
      const r = await collectionFileInit(code, memberToken, {
        name: file.name,
        size: file.size,
        content_type: file.type || null,
        chunk_size: COLLECTION_CHUNK_SIZE,
      });
      lastFileId = r.file_id;
      return {
        upload_id: r.upload_id,
        total_chunks: r.total_chunks,
        uploaded_chunks: r.uploaded_chunks ?? [],
      };
    },
    part: (uploadId, idx, blob, onProgress, signal) => {
      if (lastFileId == null) {
        throw new Error('collection upload: file_id missing — init() must run before part()');
      }
      return collectionFilePart(
        code,
        uploadId,
        lastFileId,
        memberToken,
        idx,
        blob,
        (loaded) => onProgress(loaded),
        signal,
      );
    },
    complete: async (uploadId) => {
      if (lastFileId == null) {
        throw new Error('collection upload: file_id missing — init() must run before complete()');
      }
      const r = await collectionFileComplete(code, uploadId, lastFileId, memberToken, {});
      // Backend canonical is `id`; tolerate legacy `file_id`.
      lastFileId = r.id ?? r.file_id ?? lastFileId;
      // `code` is the room code, kept on the UploadResult envelope for
      // logging parity; the meaningful id is the file id below.
      return { code, name: r.name, size: r.size };
    },
    cancel: async () => {
      // Best-effort cancel — collection uploads don't expose a dedicated
      // cancel endpoint in v0.3.0; init sessions time out server-side.
    },
    getFileId: () => lastFileId,
  };
}

function collectionPresignedTransport(
  code: string,
  memberToken: string,
  file: File,
): PresignedTransport & { getFileId: () => number | null } {
  let lastFileId: number | null = null;
  return {
    init: async () => {
      const r = await collectionFileInit(code, memberToken, {
        name: file.name,
        size: file.size,
        content_type: file.type || null,
        // For S3 the server treats `chunk_size` as the desired part size.
        chunk_size: PRESIGN_PART_SIZE,
      });
      lastFileId = r.file_id;
      return {
        upload_id: r.upload_id,
        part_size: r.part_size,
        parts_total: r.total_chunks,
      };
    },
    signPart: async (uploadId, partNumber) => {
      if (lastFileId == null) {
        throw new Error('collection upload: file_id missing — init() must run before signPart()');
      }
      const r = await collectionFileSignPart(
        code,
        uploadId,
        lastFileId,
        memberToken,
        partNumber,
      );
      return { url: r.url, headers: r.headers };
    },
    complete: async (uploadId, parts) => {
      if (lastFileId == null) {
        throw new Error('collection upload: file_id missing — init() must run before complete()');
      }
      const r = await collectionFileComplete(code, uploadId, lastFileId, memberToken, {
        parts,
      });
      lastFileId = r.id ?? r.file_id ?? lastFileId;
      return { code, name: r.name, size: r.size };
    },
    cancel: async () => {
      // No-op — see chunked transport note above.
    },
    getFileId: () => lastFileId,
  };
}

/**
 * Upload N files into an existing Collection room.
 *
 * Sequential per-file (mirrors `uploadFiles`). Each file independently
 * picks `chunked` vs `presigned` based on size + backend, then runs through
 * the shared `runChunked` / `runPresigned` loops — the only thing that
 * changes is which transport adapter is used.
 */
export function uploadFilesToCollection(
  opts: UploadFilesToCollectionOptions,
): UploadFilesToCollectionHandle {
  const controller = new AbortController();
  const abort = () => controller.abort();

  const totalBytes = opts.files.reduce((acc, f) => acc + f.size, 0);

  const run = async (): Promise<UploadFilesToCollectionResult> => {
    await enforceMultiTotalLimit(opts.files);

    for (let i = 0; i < opts.files.length; i++) {
      opts.onFileState?.(i, 'pending');
      opts.onFileProgress?.(i, 0);
    }
    opts.onOverallProgress?.(0);

    const out: CollectionUploadedFile[] = [];
    let doneTotalBytes = 0;

    for (let i = 0; i < opts.files.length; i++) {
      if (controller.signal.aborted) {
        throw new DOMException('aborted', 'AbortError');
      }
      const file = opts.files[i]!;
      opts.onFileState?.(i, 'uploading');

      try {
        // S3-backed collections must ALWAYS use the presigned multipart path,
        // regardless of file size. The chunked path (POST /files/{id}/parts/{n})
        // is a local-backend-only endpoint that 400s with
        // `local_chunk_upload_not_supported_for_backend` on S3/R2 because it
        // requires a server-side `tmp_root`. Collections have no
        // simple-upload endpoint analogue to /api/share/file, so small files
        // on S3 must also go through presigned (one-part multipart is fine).
        const useS3 = opts.storageBackend === 's3';
        const fileProgress = (frac: number) => {
          opts.onFileProgress?.(i, frac);
          if (totalBytes > 0) {
            opts.onOverallProgress?.(
              Math.min(1, (doneTotalBytes + frac * file.size) / totalBytes),
            );
          }
        };

        let result: UploadResult;
        let fileId: number | null = null;
        if (useS3) {
          const transport = collectionPresignedTransport(
            opts.collectionCode,
            opts.memberToken,
            file,
          );
          result = await runPresigned(
            file,
            transport,
            fileProgress,
            controller.signal,
            () => {
              /* no extra cancel needed */
            },
          );
          fileId = transport.getFileId();
        } else {
          const transport = collectionChunkedTransport(
            opts.collectionCode,
            opts.memberToken,
            file,
          );
          result = await runChunked(
            file,
            transport,
            fileProgress,
            controller.signal,
            () => {
              /* no extra cancel needed */
            },
          );
          fileId = transport.getFileId();
        }

        if (fileId == null) {
          throw new Error('Server did not return a file id');
        }
        out.push({ fileId, name: result.name, size: result.size });

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

    opts.onOverallProgress?.(1);
    return { files: out };
  };

  return { promise: run(), abort };
}
