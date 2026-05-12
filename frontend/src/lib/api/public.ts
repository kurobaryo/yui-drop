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
  turnstile_enabled: boolean;
  turnstile_site_key?: string | null;
  /** Optional list of allowed expiry styles surfaced by the server. */
  expire_styles?: string[];
}

/** Sensible defaults if /api/config is missing or returns an error. */
export const DEFAULT_CONFIG: PublicConfig = {
  app_name: 'Yui-Drop',
  max_upload_bytes: 10 * 1024 * 1024 * 1024, // 10 GiB
  max_text_bytes: 256 * 1024, // 256 KiB
  pickup_code_length: 6,
  storage_backend: 'local',
  turnstile_enabled: false,
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
