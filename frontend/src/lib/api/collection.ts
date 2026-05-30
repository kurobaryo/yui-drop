/**
 * Collection (共享空间) API client wrappers.
 *
 * Endpoint contract from the v0.3.0 brief — all paths under `/api/collections`.
 * Member-authenticated calls take `X-Member-Token`; admin calls take
 * `X-Admin-Password`. Both headers are forwarded via per-call axios options
 * because the shared admin Bearer interceptor must NOT see them.
 *
 * The upload helpers (init / sign-part / parts / complete) are deliberately
 * thin: the heavy lifting (chunk loop, presigned PUT loop, progress, abort)
 * lives in `lib/uploader.ts` and reuses these wrappers via URL builders.
 */
import { api } from '../api';

// ─── Common ────────────────────────────────────────────────────────────────

export type CollectionVisibility = 'public' | 'creator_only';

/** Build the `X-Member-Token` header. */
export function memberAuth(memberToken: string) {
  return { 'X-Member-Token': memberToken };
}

/** Build the `X-Admin-Password` header. */
export function adminAuth(adminPassword: string) {
  return { 'X-Admin-Password': adminPassword };
}

// ─── Create / preview / join ───────────────────────────────────────────────

export interface CreateCollectionRequest {
  name?: string | null;
  visibility: CollectionVisibility;
  entry_password?: string | null;
  admin_password: string;
  /** null = permanent. Server clamps to [1, 365] when present. */
  lifetime_days: number | null;
  /** Optional Turnstile token, gated by the same setting as uploads. */
  turnstile_token?: string | null;
}

export interface CreateCollectionResponse {
  code: string;
  name: string | null;
  visibility: CollectionVisibility;
  has_entry_password: boolean;
  expires_at: string | null;
  max_members: number;
  created_at: string;
}

export async function createCollection(
  body: CreateCollectionRequest,
): Promise<CreateCollectionResponse> {
  const { data } = await api.post<CreateCollectionResponse>(
    '/collections',
    body,
  );
  return data;
}

export interface PreviewCollectionResponse {
  /** False when the room is closed/expired. UI should refuse to render. */
  visible: boolean;
  has_entry_password: boolean;
  name: string | null;
  member_count: number;
  file_count: number;
  message_count: number;
  closed: boolean;
}

export async function previewCollection(
  code: string,
): Promise<PreviewCollectionResponse> {
  const { data } = await api.get<PreviewCollectionResponse>(
    `/collections/${code}/preview`,
  );
  return data;
}

export interface JoinCollectionRequest {
  nickname: string;
  entry_password?: string | null;
}

export interface JoinCollectionResponse {
  member_token: string;
  member_id: number;
  visibility: CollectionVisibility;
  upload_enabled: boolean;
  /** Server may return existing isCreator flag if the token is being reused. */
  is_creator?: boolean;
}

export async function joinCollection(
  code: string,
  body: JoinCollectionRequest,
): Promise<JoinCollectionResponse> {
  const { data } = await api.post<JoinCollectionResponse>(
    `/collections/${code}/join`,
    body,
  );
  return data;
}

// ─── Messages ──────────────────────────────────────────────────────────────

export interface CollectionMessage {
  id: number;
  member_id: number;
  member_nickname: string;
  body: string;
  created_at: string;
}

export interface SendMessageRequest {
  text: string;
}

export async function sendMessage(
  code: string,
  memberToken: string,
  body: SendMessageRequest,
): Promise<CollectionMessage> {
  const { data } = await api.post<CollectionMessage>(
    `/collections/${code}/messages`,
    body,
    { headers: memberAuth(memberToken) },
  );
  return data;
}

export interface ListMessagesResponse {
  messages: CollectionMessage[];
  /** Server-provided cursor for the next older page. */
  next_before_id?: number | null;
}

export interface ListMessagesOptions {
  /** Return messages with id > afterId, ascending. */
  after_id?: number;
  /** Return messages with id < beforeId, descending. */
  before_id?: number;
  limit?: number;
}

export async function listMessages(
  code: string,
  memberToken: string,
  opts: ListMessagesOptions = {},
): Promise<ListMessagesResponse> {
  const params: Record<string, number> = {};
  if (opts.after_id !== undefined) params.after_id = opts.after_id;
  if (opts.before_id !== undefined) params.before_id = opts.before_id;
  if (opts.limit !== undefined) params.limit = opts.limit;
  const { data } = await api.get<ListMessagesResponse>(
    `/collections/${code}/messages`,
    { params, headers: memberAuth(memberToken) },
  );
  return data;
}

export async function deleteMessage(
  code: string,
  messageId: number,
  memberToken: string,
  adminPassword?: string | null,
): Promise<void> {
  const headers: Record<string, string> = { ...memberAuth(memberToken) };
  if (adminPassword) Object.assign(headers, adminAuth(adminPassword));
  await api.delete(`/collections/${code}/messages/${messageId}`, { headers });
}

// ─── Files (listing / delete / download) ───────────────────────────────────

export interface CollectionFile {
  id: number;
  member_id: number;
  member_nickname: string;
  name: string;
  size: number;
  content_type: string | null;
  created_at: string;
}

export interface ListFilesResponse {
  files: CollectionFile[];
}

export async function listFiles(
  code: string,
  memberToken: string,
): Promise<ListFilesResponse> {
  const { data } = await api.get<ListFilesResponse>(
    `/collections/${code}/files`,
    { headers: memberAuth(memberToken) },
  );
  return data;
}

export async function deleteFile(
  code: string,
  fileId: number,
  memberToken: string,
  adminPassword?: string | null,
): Promise<void> {
  const headers: Record<string, string> = { ...memberAuth(memberToken) };
  if (adminPassword) Object.assign(headers, adminAuth(adminPassword));
  await api.delete(`/collections/${code}/files/${fileId}`, { headers });
}

/** Build a download URL — the server expects the member token as `?token=`
 * so anchor tags / `window.open` can hit it without setting headers. */
export function fileDownloadUrl(
  code: string,
  fileId: number,
  memberToken: string,
): string {
  const u = new URL(
    `/api/collections/${code}/files/${fileId}/download`,
    window.location.origin,
  );
  u.searchParams.set('token', memberToken);
  return u.toString();
}

// ─── Admin operations ──────────────────────────────────────────────────────

/** Returns true if the password verifies, false otherwise. */
export async function adminVerify(
  code: string,
  memberToken: string,
  adminPassword: string,
): Promise<boolean> {
  try {
    await api.post(
      `/collections/${code}/admin/verify`,
      {},
      { headers: { ...memberAuth(memberToken), ...adminAuth(adminPassword) } },
    );
    return true;
  } catch {
    return false;
  }
}

export interface ToggleUploadResponse {
  upload_enabled: boolean;
}

export async function adminToggleUpload(
  code: string,
  memberToken: string,
  adminPassword: string,
  enabled: boolean,
): Promise<ToggleUploadResponse> {
  const { data } = await api.post<ToggleUploadResponse>(
    `/collections/${code}/admin/upload-toggle`,
    { enabled },
    { headers: { ...memberAuth(memberToken), ...adminAuth(adminPassword) } },
  );
  return data;
}

export async function adminCloseRoom(
  code: string,
  memberToken: string,
  adminPassword: string,
): Promise<void> {
  await api.post(
    `/collections/${code}/admin/close`,
    {},
    { headers: { ...memberAuth(memberToken), ...adminAuth(adminPassword) } },
  );
}

// ─── File upload helpers (thin wrappers) ───────────────────────────────────

/** Result shape for the collection's `/files/init` endpoint. The server
 * returns the same envelope shape regardless of backend (`s3` vs `local`),
 * with chunked vs presigned-specific fields filled accordingly. */
export interface CollectionFileInitResponse {
  upload_id: string;
  backend: 's3' | 'local';
  total_chunks: number;
  /** Chunk size in bytes (local backend) or S3 part size (s3 backend). */
  part_size: number;
  /** Chunked-only: indices already received on a resume. */
  uploaded_chunks?: number[];
  /** S3-only: parts already completed on a resume. */
  uploaded_parts?: number[];
}

export interface CollectionFileInitRequest {
  name: string;
  size: number;
  content_type?: string | null;
  chunk_size: number;
}

export async function collectionFileInit(
  code: string,
  memberToken: string,
  body: CollectionFileInitRequest,
): Promise<CollectionFileInitResponse> {
  const { data } = await api.post<CollectionFileInitResponse>(
    `/collections/${code}/files/init`,
    body,
    { headers: memberAuth(memberToken) },
  );
  return data;
}

export interface CollectionSignPartResponse {
  url: string;
  headers: Record<string, string>;
  part_number: number;
  expires_at: string;
}

export async function collectionFileSignPart(
  code: string,
  uploadId: string,
  memberToken: string,
  partNumber: number,
): Promise<CollectionSignPartResponse> {
  const { data } = await api.post<CollectionSignPartResponse>(
    `/collections/${code}/files/${uploadId}/sign-part`,
    { part_number: partNumber },
    { headers: memberAuth(memberToken) },
  );
  return data;
}

export async function collectionFilePart(
  code: string,
  uploadId: string,
  memberToken: string,
  chunkIndex: number,
  blob: Blob,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const fd = new FormData();
  fd.append('chunk', blob);
  await api.post(
    `/collections/${code}/files/${uploadId}/parts/${chunkIndex}`,
    fd,
    {
      headers: memberAuth(memberToken),
      onUploadProgress: (e) => {
        if (onProgress) onProgress(e.loaded, e.total ?? blob.size);
      },
      signal,
    },
  );
}

export interface CollectionCompletePart {
  part_number: number;
  etag: string;
}

export interface CollectionFileCompleteRequest {
  /** Present for s3 backend, omitted for local. */
  parts?: CollectionCompletePart[];
}

export interface CollectionFileCompleteResponse {
  file_id: number;
  name: string;
  size: number;
  content_type: string | null;
  created_at: string;
}

export async function collectionFileComplete(
  code: string,
  uploadId: string,
  memberToken: string,
  body: CollectionFileCompleteRequest,
): Promise<CollectionFileCompleteResponse> {
  const { data } = await api.post<CollectionFileCompleteResponse>(
    `/collections/${code}/files/${uploadId}/complete`,
    body,
    { headers: memberAuth(memberToken) },
  );
  return data;
}
