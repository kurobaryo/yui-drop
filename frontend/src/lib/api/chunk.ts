/**
 * Server-proxied chunked upload — used when the storage backend can't issue
 * presigned URLs (local FS / OneDrive simple / WebDAV).
 */
import { api } from '../api';
import type { ExpireStyle } from './share';

export interface ChunkInitRequest {
  file_name: string;
  file_size: number;
  chunk_size: number;
  file_hash?: string | null;
  content_type?: string | null;
  expire_value: number;
  expire_style: ExpireStyle;
  /** Turnstile token gated by `turnstile.protect_upload`. */
  turnstile_token?: string | null;
}
export interface ChunkInitResponse {
  upload_id: string;
  total_chunks: number;
  uploaded_chunks: number[];
  resumed: boolean;
}
export async function chunkInit(
  body: ChunkInitRequest,
): Promise<ChunkInitResponse> {
  const { data } = await api.post<ChunkInitResponse>('/chunk/upload/init', body);
  return data;
}

export async function chunkPart(
  uploadId: string,
  chunkIndex: number,
  blob: Blob,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const fd = new FormData();
  fd.append('chunk', blob);
  await api.post(`/chunk/upload/${uploadId}/${chunkIndex}`, fd, {
    onUploadProgress: (e) => {
      if (onProgress) onProgress(e.loaded, e.total ?? blob.size);
    },
    signal,
  });
}

export interface ChunkStatusResponse {
  upload_id: string;
  file_name: string;
  file_size: number;
  chunk_size: number | null;
  total_chunks: number;
  uploaded_chunks: number[];
  expires_at: string;
}
export async function chunkStatus(
  uploadId: string,
): Promise<ChunkStatusResponse> {
  const { data } = await api.get<ChunkStatusResponse>(
    `/chunk/upload/${uploadId}`,
  );
  return data;
}

export interface ChunkCompleteResponse {
  code: string;
  name: string;
  size: number;
}
export async function chunkComplete(
  uploadId: string,
  expireValue: number,
  expireStyle: ExpireStyle,
): Promise<ChunkCompleteResponse> {
  const { data } = await api.post<ChunkCompleteResponse>(
    `/chunk/upload/${uploadId}/complete`,
    { expire_value: expireValue, expire_style: expireStyle },
  );
  return data;
}

export async function chunkCancel(uploadId: string): Promise<void> {
  await api.delete(`/chunk/upload/${uploadId}`);
}
