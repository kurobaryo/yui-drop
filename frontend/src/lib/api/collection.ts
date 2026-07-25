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
  /** Optional creator nickname; backend defaults to "Owner" if absent. */
  creator_nickname?: string | null;
  /** Optional Turnstile token, gated by the same setting as uploads. */
  turnstile_token?: string | null;
  /** v2 per-room policy; enforced by the backend. null capacity = unlimited. */
  max_file_bytes?: number | null;
  capacity_bytes?: number | null;
  allow_messages?: boolean;
  notify_on_activity?: boolean;
}

export interface CreateCollectionResponse {
  code: string;
  name: string | null;
  visibility: CollectionVisibility;
  upload_enabled?: boolean;
  has_entry_password: boolean;
  expires_at: string | null;
  /** Auto-issued token for the creator. Persist this in the room store
   * (under `yui-collection:member:{code}`) so Room.tsx can call APIs
   * without a separate /join round-trip. */
  member_token: string | null;
  member_id: number | null;
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
  /** Backend returns this in the preview payload; used for the drop hint. */
  visibility?: CollectionVisibility;
  /** v2 per-room policy (server-enforced). null capacity = unlimited. */
  max_file_bytes?: number | null;
  capacity_bytes?: number | null;
  allow_messages?: boolean;
  notify_on_activity?: boolean;
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
  /** Display name of the member who sent this message. Backend serializer
   * in ``app/services/collections.py`` returns ``nickname`` for both
   * messages AND files (see ``_file_dto`` / ``_message_to_dto``). */
  nickname: string;
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
  nickname: string;
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
 * so anchor tags / `window.open` can hit it without setting headers.
 *
 * NOTE: this returns the *resolver* URL — hitting it returns a JSON envelope
 * with the real ``download_url``. For end-user "click to download" use
 * :func:`triggerFileDownload` which resolves and navigates. Anchor tags
 * pointing at this URL directly will render the JSON envelope in the page —
 * a real-world bug in earlier builds. */
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

/** Resolve a collection file's actual download URL and trigger the browser
 * download. Handles both S3 backends (presigned absolute URL) and the local
 * backend (same-origin ``/blob?token=<jwt>`` path).
 *
 * Why this exists: an earlier build wired `<a href={fileDownloadUrl(...)}>`
 * straight at the resolver endpoint. That endpoint returns the JSON envelope
 * ``{download_url, expires_in}`` — clicking the link rendered the JSON in
 * the page instead of downloading. The fix is to fetch the envelope, then
 * follow the inner URL.
 *
 * Also handles auth correctly: the resolver wants the member token (header
 * or query); the resolved blob URL embeds its own short-lived JWT and needs
 * no further auth.
 */
export async function triggerFileDownload(
  code: string,
  fileId: number,
  memberToken: string,
): Promise<void> {
  const url = await resolveFileDownloadUrl(code, fileId, memberToken);
  // Open in a new tab so the current room/timeline stays mounted. The blob
  // endpoint sends `Content-Disposition: attachment` so the browser saves
  // the file and closes the tab automatically on most platforms.
  window.open(url, '_blank', 'noopener');
}

/** Resolve-only sibling of :func:`triggerFileDownload`. Returns the inner
 * download URL without navigating, so callers can hand it to `<img src>`,
 * `<iframe src>`, `<video src>`, an in-page preview modal, or any other
 * consumer that wants the bytes directly.
 *
 * Same backend contract as triggerFileDownload — calls the resolver, reads
 * the JSON envelope, returns the absolute URL. Throws on resolver error
 * (404 file_not_yet_uploaded for orphan rows, etc.). */
export async function resolveFileDownloadUrl(
  code: string,
  fileId: number,
  memberToken: string,
): Promise<string> {
  const { data } = await api.get<{ download_url: string; expires_in: number }>(
    `/collections/${code}/files/${fileId}/download`,
    { headers: memberAuth(memberToken) },
  );
  const url = data?.download_url;
  if (!url) throw new Error('download URL missing in resolver response');
  return url;
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
  file_id: number;
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
  fileId: number,
  memberToken: string,
  partNumber: number,
): Promise<CollectionSignPartResponse> {
  // Backend route: POST /collections/{code}/files/{file_id}/sign-part/{part_number}
  // upload_id travels as a query-string parameter (the route reads it that way
  // because the multipart upload_id is the long opaque S3 handle, not a path
  // segment). Passing uploadId in the path slot returns 405 Method Not Allowed.
  const { data } = await api.post<CollectionSignPartResponse>(
    `/collections/${code}/files/${fileId}/sign-part/${partNumber}`,
    {},
    {
      headers: memberAuth(memberToken),
      params: { upload_id: uploadId },
    },
  );
  return data;
}

export async function collectionFilePart(
  code: string,
  uploadId: string,
  fileId: number,
  memberToken: string,
  chunkIndex: number,
  blob: Blob,
  onProgress?: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const fd = new FormData();
  fd.append('upload_id', uploadId);
  fd.append('chunk', blob);
  await api.post(
    `/collections/${code}/files/${fileId}/parts/${chunkIndex}`,
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
  // Backend returns ``id`` (the CollectionFile primary key); ``file_id``
  // is the legacy alias we used to publish — keep both readable so older
  // frontend code keeps compiling while we migrate.
  id: number;
  file_id?: number;
  name: string;
  size: number;
  content_type: string | null;
  member_id?: number;
  created_at?: string;
}

export async function collectionFileComplete(
  code: string,
  uploadId: string,
  fileId: number,
  memberToken: string,
  body: CollectionFileCompleteRequest,
): Promise<CollectionFileCompleteResponse> {
  // Backend wants the numeric file_id in the path slot and the opaque
  // multipart upload_id inside the JSON body. Mixing the two yields a
  // 404 (file_id parse) or a 422 (missing upload_id field).
  const payload = { ...body, upload_id: uploadId };
  const { data } = await api.post<CollectionFileCompleteResponse>(
    `/collections/${code}/files/${fileId}/complete`,
    payload,
    { headers: memberAuth(memberToken) },
  );
  return data;
}
