/**
 * Share endpoints: text drops, single-shot file uploads, code resolution,
 * and the token-protected download fallback.
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
): Promise<ShareFileResponse> {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('expire_value', String(expireValue));
  fd.append('expire_style', expireStyle);
  const { data } = await api.post<ShareFileResponse>('/share/file', fd, {
    onUploadProgress: (e) => {
      if (onProgress) onProgress(e.loaded, e.total ?? file.size);
    },
    signal,
  });
  return data;
}

export interface ShareSelectResponse {
  code: string;
  kind: 'text' | 'file';
  name: string | null;
  size: number | null;
  text: string | null;
  url: string | null;
  content_type: string | null;
  force_download: boolean;
  expired_at: string | null;
  expired_count: number;
  used_count: number;
}

export async function shareSelect(
  code: string,
): Promise<ShareSelectResponse> {
  const { data } = await api.post<ShareSelectResponse>('/share/select', {
    code,
  });
  return data;
}

/** Build a token-protected download URL (used when the server returns one). */
export function downloadUrl(code: string, key: string): string {
  const u = new URL('/api/share/download', window.location.origin);
  u.searchParams.set('code', code);
  u.searchParams.set('key', key);
  return u.toString();
}
