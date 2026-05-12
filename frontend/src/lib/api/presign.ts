/**
 * S3 / R2 multipart presign API. The browser streams parts directly to the
 * bucket using URLs signed by the server; we only call init / sign-part /
 * complete on this API.
 */
import { api } from '../api';
import type { ExpireStyle } from './share';

export interface PresignInitRequest {
  file_name: string;
  file_size: number;
  content_type?: string | null;
  expire_value: number;
  expire_style: ExpireStyle;
}
export interface PresignInitResponse {
  upload_id: string;
  key: string;
  part_size: number;
  parts_total: number;
  s3_upload_id: string;
  expires_at: string;
}
export async function presignInit(
  body: PresignInitRequest,
): Promise<PresignInitResponse> {
  const { data } = await api.post<PresignInitResponse>('/presign/init', body);
  return data;
}

export interface PresignSignPartResponse {
  url: string;
  headers: Record<string, string>;
  expires_at: string;
  part_number: number;
}
export async function presignSignPart(
  uploadId: string,
  partNumber: number,
): Promise<PresignSignPartResponse> {
  const { data } = await api.post<PresignSignPartResponse>(
    `/presign/${uploadId}/sign-part`,
    { part_number: partNumber },
  );
  return data;
}

export interface PresignCompletePart {
  part_number: number;
  etag: string;
}
export interface PresignCompleteResponse {
  code: string;
  name: string;
  size: number;
}
export async function presignComplete(
  uploadId: string,
  parts: PresignCompletePart[],
): Promise<PresignCompleteResponse> {
  const { data } = await api.post<PresignCompleteResponse>(
    `/presign/${uploadId}/complete`,
    { parts },
  );
  return data;
}

export async function presignCancel(uploadId: string): Promise<void> {
  await api.delete(`/presign/${uploadId}`);
}

export interface PresignStatusResponse {
  upload_id: string;
  key: string;
  file_name: string;
  file_size: number;
  parts_total: number;
  parts_uploaded: number[];
  expires_at: string;
}
export async function presignStatus(
  uploadId: string,
): Promise<PresignStatusResponse> {
  const { data } = await api.get<PresignStatusResponse>(
    `/presign/${uploadId}`,
  );
  return data;
}
