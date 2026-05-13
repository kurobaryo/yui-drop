/**
 * Public (unauthenticated) API endpoints.
 */
import { api } from '../api';

export interface PublicConfig {
  app_name: string;
  app_url?: string;
  max_upload_bytes: number;
  max_text_bytes: number;
  pickup_code_length: number;
  storage_backend: 'local' | 's3' | 'onedrive' | 'webdav';
  /** Turnstile site key — only emitted by the server when Turnstile is fully
   * configured (master toggle on AND both keys set). If null/undefined the
   * frontend skips the widget entirely. Note the camelCase wire name. */
  turnstileSiteKey?: string | null;
  /** Per-action protection flags. The maintainer added these alongside the
   * master `turnstile_enabled` switch so individual flows (upload / pickup)
   * can be gated independently. Backend fills these in via /api/config —
   * frontend just trusts whatever it gets and defaults to `false`. */
  turnstileProtectUpload: boolean;
  turnstileProtectPickup: boolean;
  /** Optional list of allowed expiry styles surfaced by the server. */
  expire_styles?: string[];
  /** Optional multi-file caps; if absent, fall back to max_upload_bytes. */
  max_file_bytes?: number;
  max_share_total_bytes?: number;
  max_files_per_share?: number;
}

/** Sensible defaults if /api/config is missing or returns an error. */
export const DEFAULT_CONFIG: PublicConfig = {
  app_name: 'Yui-Drop',
  max_upload_bytes: 10 * 1024 * 1024 * 1024, // 10 GiB
  max_text_bytes: 256 * 1024, // 256 KiB
  pickup_code_length: 6,
  storage_backend: 'local',
  turnstileProtectUpload: false,
  turnstileProtectPickup: false,
};

export async function getConfig(): Promise<PublicConfig> {
  try {
    const { data } = await api.get<PublicConfig>('/config');
    return { ...DEFAULT_CONFIG, ...data };
  } catch {
    // /api/config may not be implemented yet — fall back gracefully.
    return DEFAULT_CONFIG;
  }
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: 'ok' | 'fail';
}
export async function getHealth(): Promise<HealthResponse> {
  const { data } = await api.get<HealthResponse>('/health');
  return data;
}
