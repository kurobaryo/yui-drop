/**
 * Admin API-key endpoints. All require Bearer token (auto-injected by the
 * axios interceptor). The shared `api` client already unwraps the
 * `{ code, message, detail }` envelope, so callers see the inner detail
 * directly as `response.data`.
 *
 * Mirrors the style of `./admin.ts` — one function per endpoint, plus the
 * TypeScript wire shapes the rest of the admin UI consumes.
 */
import { api } from '../api';

// ── Types ─────────────────────────────────────────────────────────────────
export type ApiKeyScope = 'upload' | 'read';

export interface ApiKeyListItem {
  id: number;
  key_id: string;
  note: string | null;
  scopes: ApiKeyScope[];
  quota_daily_bytes: number;
  quota_per_minute: number;
  max_file_size: number;
  expires_at: string | null; // ISO
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
  created_by_admin: string | null;
  is_active: boolean;
}

export interface ApiKeyCreateRequest {
  note?: string | null;
  scopes?: ApiKeyScope[];
  quota_daily_bytes?: number;
  quota_per_minute?: number;
  max_file_size?: number;
  /** null = never expires; omit → backend default (365 days). */
  expires_in_days?: number | null;
}

export interface ApiKeyCreateResponse extends ApiKeyListItem {
  /** Plaintext secret. Shown to the operator exactly once. */
  plaintext: string;
}

export interface ApiKeyUpdateRequest {
  note?: string | null;
  scopes?: ApiKeyScope[];
  quota_daily_bytes?: number;
  quota_per_minute?: number;
  max_file_size?: number;
  expires_at?: string | null;
  /** Explicit "clear the expiry" flag — distinguishes "leave alone" from "set to never". */
  clear_expires_at?: boolean;
}

export interface ApiKeyUsageDay {
  date: string;
  total_bytes: number;
  total_calls: number;
}

export interface ApiKeyUsageResponse {
  key_id: string;
  days: ApiKeyUsageDay[];
  totals: {
    total_bytes: number;
    total_calls: number;
  };
}

// ── Endpoints ─────────────────────────────────────────────────────────────
export async function listApiKeys(): Promise<{ items: ApiKeyListItem[] }> {
  const { data } = await api.get<{ items: ApiKeyListItem[] }>('/admin/api-keys');
  return data;
}

export async function createApiKey(
  body: ApiKeyCreateRequest,
): Promise<ApiKeyCreateResponse> {
  const { data } = await api.post<ApiKeyCreateResponse>('/admin/api-keys', body);
  return data;
}

export async function getApiKey(keyPk: number): Promise<ApiKeyListItem> {
  const { data } = await api.get<ApiKeyListItem>(`/admin/api-keys/${keyPk}`);
  return data;
}

export async function updateApiKey(
  keyPk: number,
  body: ApiKeyUpdateRequest,
): Promise<ApiKeyListItem> {
  const { data } = await api.patch<ApiKeyListItem>(
    `/admin/api-keys/${keyPk}`,
    body,
  );
  return data;
}

export async function revokeApiKey(keyPk: number): Promise<ApiKeyListItem> {
  const { data } = await api.delete<ApiKeyListItem>(`/admin/api-keys/${keyPk}`);
  return data;
}

export async function getApiKeyUsage(
  keyPk: number,
  days = 30,
): Promise<ApiKeyUsageResponse> {
  const { data } = await api.get<ApiKeyUsageResponse>(
    `/admin/api-keys/${keyPk}/usage`,
    { params: { days } },
  );
  return data;
}
