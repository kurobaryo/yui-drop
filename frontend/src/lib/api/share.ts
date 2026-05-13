/**
 * Share endpoints: text drops, single-shot file uploads, code resolution,
 * the token-protected download fallback, and multi-file share orchestration.
 */
import { api } from '../api';

export type ExpireStyle =
  | 'minute'
  | 'hour'
  | 'day'
  | 'week'
  | 'month'
  | 'year'
  | 'count'
  | 'forever';

export interface ShareTextRequest {
  text: string;
  expire_value: number;
  expire_style: ExpireStyle;
  /** Cloudflare Turnstile token from the in-page widget. Required when the
   * admin has set `turnstile.protect_upload`; ignored otherwise. */
  turnstile_token?: string | null;
}
export interface ShareTextResponse {
  code: string;
  name: string | null;
  expired_at: string | null;
  expired_count: number;
}

export async function shareText(
  body: ShareTextRequest,
): Promise<ShareTextResponse> {
  const { data } = await api.post<ShareTextResponse>('/share/text', body);
  return data;
}

export interface ShareFileResponse {
  code: string;
  name: string;
  size: number;
  expired_at: string | null;
  expired_count: number;
}

export async function shareFileMultipart(
  file: File,
  expireValue: number,
  expireStyle: ExpireStyle,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
  turnstileToken?: string | null,
): Promise<ShareFileResponse> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('expire_value', String(expireValue));
  fd.append('expire_style', expireStyle);
  if (turnstileToken) fd.append('turnstile_token', turnstileToken);
  const { data } = await api.post<ShareFileResponse>('/share/file', fd, {
    onUploadProgress: (e) => {
      if (onProgress) onProgress(e.loaded, e.total ?? file.size);
    },
    signal,
  });
  return data;
}

/** A single file inside a multi-share response. */
export interface ShareMultiFile {
  file_id: number;
  order: number;
  name: string;
  size: number;
  url: string | null;
  content_type: string | null;
  force_download: boolean;
}

export interface ShareSelectResponse {
  code: string;
  kind: 'text' | 'file' | 'multi';
  name: string | null;
  size: number | null;
  text: string | null;
  url: string | null;
  content_type: string | null;
  force_download: boolean;
  expired_at: string | null;
  expired_count: number;
  used_count: number;
  /** Present only when kind === 'multi'. */
  file_count?: number;
  total_size?: number;
  files?: ShareMultiFile[];
}

export async function shareSelect(
  code: string,
  turnstileToken?: string | null,
): Promise<ShareSelectResponse> {
  const body: { code: string; turnstile_token?: string } = { code };
  if (turnstileToken) body.turnstile_token = turnstileToken;
  const { data } = await api.post<ShareSelectResponse>('/share/select', body);
  return data;
}

/** Build a token-protected download URL (used when the server returns one). */
export function downloadUrl(code: string, key: string): string {
  const u = new URL('/api/share/download', window.location.origin);
  u.searchParams.set('code', code);
  u.searchParams.set('key', key);
  return u.toString();
}

// ─── Multi-file share orchestration ─────────────────────────────────────────

export interface MultiInitRequest {
  declared_file_count: number;
  declared_total_size: number;
  expire_value: number;
  expire_style: ExpireStyle;
  /** Turnstile token — same gating as the simple-upload path. */
  turnstile_token?: string | null;
}
export interface MultiInitResponse {
  share_id: number;
  code: string;
  upload_token: string;
  expired_at: string | null;
  expired_count: number;
}
export async function multiInit(
  body: MultiInitRequest,
): Promise<MultiInitResponse> {
  const { data } = await api.post<MultiInitResponse>('/share/multi/init', body);
  return data;
}

export interface MultiFileInitRequest {
  name: string;
  size: number;
  content_type?: string | null;
  declared_chunked: boolean;
  chunk_size?: number;
}
export interface MultiFileInitResponse {
  file_id: number;
  upload_id: string;
  upload_url: string;
  chunk_size: number;
  total_chunks: number;
  presign_payload: unknown | null;
}
export async function multiFileInit(
  shareId: number,
  uploadToken: string,
  body: MultiFileInitRequest,
): Promise<MultiFileInitResponse> {
  const { data } = await api.post<MultiFileInitResponse>(
    `/share/multi/${shareId}/file/init`,
    body,
    { headers: { Authorization: `Bearer ${uploadToken}` } },
  );
  return data;
}

export interface MultiFileCompleteRequest {
  total_uploaded_bytes: number;
  etag_list?: string[] | null;
}
export interface MultiFileCompleteResponse {
  ok: boolean;
  size_verified: boolean;
  file_id: number;
  size: number;
}
export async function multiFileComplete(
  shareId: number,
  fileId: number,
  uploadToken: string,
  body: MultiFileCompleteRequest,
): Promise<MultiFileCompleteResponse> {
  const { data } = await api.post<MultiFileCompleteResponse>(
    `/share/multi/${shareId}/file/${fileId}/complete`,
    body,
    { headers: { Authorization: `Bearer ${uploadToken}` } },
  );
  return data;
}

export interface MultiFinalizeResponse {
  code: string;
  expired_at: string | null;
  file_count: number;
  total_size: number;
}
export async function multiFinalize(
  shareId: number,
  uploadToken: string,
): Promise<MultiFinalizeResponse> {
  const { data } = await api.post<MultiFinalizeResponse>(
    `/share/multi/${shareId}/finalize`,
    {},
    { headers: { Authorization: `Bearer ${uploadToken}` } },
  );
  return data;
}
