/**
 * Admin endpoints. All require Bearer token (auto-injected via the axios
 * interceptor reading from the zustand admin store).
 */
import { api } from '../api';

// ── Auth ──────────────────────────────────────────────────────────────────
export interface AdminLoginResponse {
  token: string;
  token_type: 'Bearer';
  expires_at: string;
}
export async function adminLogin(password: string): Promise<AdminLoginResponse> {
  const { data } = await api.post<AdminLoginResponse>('/admin/login', {
    password,
  });
  return data;
}

// ── Dashboard ─────────────────────────────────────────────────────────────
export interface DashboardCounters {
  uploads: number;
  retrievals: number;
}
export interface DashboardResponse {
  totalFiles: number;
  storageUsed: number;
  recycledFiles: number;
  sysUptime: number;
  today: DashboardCounters;
  yesterday: DashboardCounters;
}
export async function getDashboard(): Promise<DashboardResponse> {
  const { data } = await api.get<DashboardResponse>('/admin/dashboard');
  return data;
}

// ── Files ─────────────────────────────────────────────────────────────────
export interface AdminFileRow {
  id: number;
  code: string;
  prefix: string | null;
  suffix: string | null;
  name: string | null;
  size: number;
  is_text: boolean;
  is_chunked: boolean;
  file_hash: string | null;
  expired_at: string | null;
  expired_count: number;
  used_count: number;
  deleted_at: string | null;
  created_at: string | null;
  created_by_ip?: string | null;
  created_by_ua?: string | null;
}
export interface AdminFileListResponse {
  items: AdminFileRow[];
  total: number;
  page: number;
  size: number;
}

export interface AdminFileListParams {
  page?: number;
  size?: number;
  keyword?: string;
  include_deleted?: boolean;
}
export async function listFiles(
  params: AdminFileListParams = {},
): Promise<AdminFileListResponse> {
  const { data } = await api.get<AdminFileListResponse>('/admin/file', {
    params: {
      page: params.page ?? 1,
      size: params.size ?? 20,
      keyword: params.keyword || undefined,
      include_deleted: params.include_deleted ?? false,
    },
  });
  return data;
}

export interface AdminFilePatch {
  code?: string;
  prefix?: string;
  suffix?: string;
  expired_at?: string | null;
  expired_count?: number | null;
}
export async function patchFile(
  id: number,
  patch: AdminFilePatch,
): Promise<AdminFileRow> {
  const { data } = await api.patch<AdminFileRow>(`/admin/file/${id}`, patch);
  return data;
}

export async function restoreFile(id: number): Promise<AdminFileRow> {
  const { data } = await api.post<AdminFileRow>(`/admin/file/${id}/restore`);
  return data;
}

export async function deleteFile(id: number, hard = false): Promise<void> {
  await api.delete(`/admin/file/${id}`, { params: { hard } });
}

export async function emptyRecycleBin(): Promise<{ deleted: number }> {
  const { data } = await api.delete<{ deleted: number }>('/admin/recycle-bin');
  return data;
}

// ── File detail by code (G.4) ─────────────────────────────────────────────
/**
 * Shape returned by `GET /api/admin/files/{code}`. Mirrors the row that
 * powers the list view but with a couple of drawer-only extras
 * (`file_path`, `storage_backend`) and the audit columns always present.
 */
export interface AdminFileDetail extends AdminFileRow {
  file_path: string | null;
  storage_backend: string | null;
}

export async function getFileByCode(code: string): Promise<AdminFileDetail> {
  const { data } = await api.get<AdminFileDetail>(
    `/admin/files/${encodeURIComponent(code)}`,
  );
  return data;
}

export interface AdminFileAccessLogItem {
  ts: string | null;
  action: string;
  ip: string | null;
  ua: string | null;
  status_code: number | null;
  /** Free-form metadata blob. Contains ``event`` and ``reason`` keys. */
  extra: Record<string, unknown> | null;
}
export interface AdminFileAccessLogResponse {
  items: AdminFileAccessLogItem[];
  code: string;
}
export async function getFileAccessLog(
  code: string,
  limit = 200,
): Promise<AdminFileAccessLogResponse> {
  const { data } = await api.get<AdminFileAccessLogResponse>(
    `/admin/files/${encodeURIComponent(code)}/access-log`,
    { params: { limit } },
  );
  return data;
}

/**
 * Shape returned by `GET /api/admin/files/{code}/content`.
 *
 * This endpoint is admin-only and gated by the same Bearer-token middleware
 * as the rest of `/admin/*`. It does not bump `used_count` or decrement
 * `expired_count` on the underlying share row — admin previews never
 * pollute the public-facing audit trail.
 */
export interface AdminFileContent {
  code: string;
  text: string;
  size: number | null;
  kind: 'text';
  mime: string;
}
export async function getFileContent(code: string): Promise<AdminFileContent> {
  const { data } = await api.get<AdminFileContent>(
    `/admin/files/${encodeURIComponent(code)}/content`,
  );
  return data;
}

/**
 * Fetch the admin-only binary download as a Blob, then trigger a browser
 * "Save As" via a transient object URL. Using fetch (rather than a plain
 * `<a download>`) keeps the Bearer token in the `Authorization` header
 * instead of leaking it through a query string in browser history /
 * server logs. The endpoint emits exactly one `admin_action` audit row
 * tagged `extra.reason='admin_preview'`; it does not increment the
 * share's `used_count`.
 */
export async function downloadFileAsAdmin(
  code: string,
  fallbackName: string,
): Promise<void> {
  const resp = await api.get<Blob>(
    `/admin/files/${encodeURIComponent(code)}/download`,
    { responseType: 'blob' },
  );
  // Extract filename from Content-Disposition when present; otherwise
  // fall back to the share's recorded name.
  const cd =
    (resp.headers['content-disposition'] as string | undefined) ?? '';
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/.exec(cd);
  const name = decodeURIComponent(m?.[1] ?? m?.[2] ?? fallbackName);
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so Safari has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Logs ──────────────────────────────────────────────────────────────────
export interface AdminLogRow {
  id: number;
  ts: string | null;
  action: string;
  code: string | null;
  ip: string | null;
  ua: string | null;
  status_code: number | null;
  extra: Record<string, unknown> | null;
}
export interface AdminLogListResponse {
  items: AdminLogRow[];
  total: number;
  page: number;
  size: number;
}
export interface AdminLogListParams {
  page?: number;
  size?: number;
  action?: string;
  ip?: string;
}
export async function listLogs(
  params: AdminLogListParams = {},
): Promise<AdminLogListResponse> {
  const { data } = await api.get<AdminLogListResponse>('/admin/logs', {
    params: {
      page: params.page ?? 1,
      size: params.size ?? 20,
      action: params.action || undefined,
      ip: params.ip || undefined,
    },
  });
  return data;
}

// ── Settings ──────────────────────────────────────────────────────────────
export interface AdminSettingsResponse {
  kv: Record<string, unknown>;
  env: {
    turnstile_enabled: boolean;
    turnstile_site_key_present: boolean;
    turnstile_secret_key_present: boolean;
    storage_backend: string;
    app_name: string;
    app_url: string | null;
    max_upload_bytes: number;
    max_text_bytes: number;
    pickup_code_length: number;
    /** G.3 toggle. Defaults to true on the backend when the kv row is absent. */
    audit_log_access_ip: boolean;
  };
}
export async function getAdminSettings(): Promise<AdminSettingsResponse> {
  const { data } = await api.get<AdminSettingsResponse>('/admin/settings');
  return data;
}
export async function patchAdminSettings(
  updates: Record<string, unknown>,
): Promise<AdminSettingsResponse> {
  const { data } = await api.patch<AdminSettingsResponse>(
    '/admin/settings',
    updates,
  );
  return data;
}

// ── Storage backend (H.6) ─────────────────────────────────────────────────
/**
 * Shape returned by `GET /api/admin/storage`. ``secret_access_key`` is always
 * masked as ``"****"`` when something is stored, and the empty string when
 * nothing is yet on file. The wire never sees the plaintext after save.
 */
export interface StorageConfigResponse {
  backend: 'local' | 's3' | null;
  s3?: {
    endpoint_url: string;
    bucket_name: string;
    access_key_id: string;
    secret_access_key: string;
    region: string;
    public_hostname: string;
    prefix: string;
  };
}

/**
 * Shape accepted by `POST /api/admin/storage`. For ``secret_access_key``:
 *   - ``null``  → keep the existing encrypted value on the server.
 *   - string    → replace; the server encrypts before storing.
 */
export interface StorageConfigRequest {
  backend: 'local' | 's3';
  s3?: {
    endpoint_url: string;
    bucket_name: string;
    access_key_id: string;
    secret_access_key: string | null;
    region: string;
    public_hostname: string | null;
    prefix?: string;
  };
}

export async function getAdminStorage(): Promise<StorageConfigResponse> {
  const { data } = await api.get<StorageConfigResponse>('/admin/storage');
  return data;
}

export async function postAdminStorage(
  body: StorageConfigRequest,
): Promise<StorageConfigResponse> {
  const { data } = await api.post<StorageConfigResponse>('/admin/storage', body);
  return data;
}

// ── Turnstile config (admin) ──────────────────────────────────────────────
export interface TurnstileConfigResponse {
  enabled: boolean;
  site_key: string;
  secret_key_set: boolean;
  /** Per-action protection toggles. Defaults to false on the backend; the
   * `protect_admin_login` flag is wire-stable but not yet enforced server-side
   * (the UI displays it as "coming soon"). */
  protect_upload: boolean;
  protect_pickup: boolean;
  protect_admin_login: boolean;
}

export interface TurnstileConfigRequest {
  enabled?: boolean;
  site_key?: string;
  // Empty string ⇒ keep existing on the server.
  secret_key?: string;
  protect_upload?: boolean;
  protect_pickup?: boolean;
  protect_admin_login?: boolean;
}

export async function getAdminTurnstile(): Promise<TurnstileConfigResponse> {
  const { data } = await api.get<TurnstileConfigResponse>('/admin/turnstile');
  return data;
}

export async function putAdminTurnstile(
  body: TurnstileConfigRequest,
): Promise<TurnstileConfigResponse> {
  const { data } = await api.put<TurnstileConfigResponse>(
    '/admin/turnstile',
    body,
  );
  return data;
}

// ── Upload limits (admin) ─────────────────────────────────────────────────
export interface UploadLimitsResponse {
  simple_upload_max_bytes: number;
  chunk_upload_max_bytes: number;
  multi_total_max_bytes: number;
  chunk_upload_enabled: boolean;
}

export interface UploadLimitsRequest {
  simple_upload_max_bytes?: number;
  chunk_upload_max_bytes?: number;
  multi_total_max_bytes?: number;
  chunk_upload_enabled?: boolean;
}

export async function getAdminUploads(): Promise<UploadLimitsResponse> {
  const { data } = await api.get<UploadLimitsResponse>('/admin/uploads');
  return data;
}

export async function putAdminUploads(
  body: UploadLimitsRequest,
): Promise<UploadLimitsResponse> {
  const { data } = await api.put<UploadLimitsResponse>('/admin/uploads', body);
  return data;
}
