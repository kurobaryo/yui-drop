/**
 * Axios instance + envelope unwrapping for Yui-Drop.
 *
 * Every backend endpoint returns the envelope shape:
 *   { code: number, message: string, detail: T | null }
 * where `code === 2000` is success and anything else is an app-level error.
 *
 * The response interceptor:
 *   - unwraps `detail` into `response.data` so call-sites just see T,
 *   - throws ApiError on non-2000 codes,
 *   - normalises network/timeout/HTTP failures into ApiError too.
 *
 * The request interceptor injects the admin Bearer token (if present) from
 * the zustand admin store. Public endpoints simply ignore the header.
 */
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from 'axios';

import { useAdminStore } from '@/stores/admin';

export const SUCCESS_CODE = 2000;

export class ApiError extends Error {
  code: number;
  detail: unknown;
  httpStatus: number | null;

  constructor(
    code: number,
    message: string,
    detail: unknown = null,
    httpStatus: number | null = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.detail = detail;
    this.httpStatus = httpStatus;
  }
}

/** Standard backend envelope. */
export interface Envelope<T> {
  code: number;
  message: string;
  detail: T | null;
}

export interface ApiOptions extends AxiosRequestConfig {
  /** Skip the envelope unwrap (e.g. when calling raw S3 PUTs). */
  raw?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Instance creation
// ────────────────────────────────────────────────────────────────────────────

function createClient(): AxiosInstance {
  const inst = axios.create({
    baseURL: '/api',
    timeout: 0, // uploads can be long; let callers cancel via AbortController
    headers: { 'Content-Type': 'application/json' },
  });

  inst.interceptors.request.use((config) => {
    // Don't override Content-Type when caller is doing FormData.
    if (
      typeof FormData !== 'undefined' &&
      config.data instanceof FormData &&
      config.headers
    ) {
      // axios will set the multipart boundary itself when Content-Type is unset
      delete (config.headers as Record<string, unknown>)['Content-Type'];
    }
    // Inject admin token if available — but NEVER clobber an Authorization
    // header the caller already set explicitly (e.g. the multi-file upload
    // flow passes a scoped upload_token). Overriding it here made share
    // multi/file/init return 403 for any browser that had an admin session
    // persisted in localStorage.
    const token = useAdminStore.getState().token;
    const hasExplicitAuth =
      !!config.headers &&
      Object.keys(config.headers as Record<string, unknown>).some(
        (k) => k.toLowerCase() === 'authorization',
      );
    if (token && config.headers && !hasExplicitAuth) {
      (config.headers as Record<string, string>).Authorization =
        `Bearer ${token}`;
    }
    return config;
  });

  inst.interceptors.response.use(
    (response: AxiosResponse) => {
      // raw passthrough (set via `(config as ApiOptions).raw = true`)
      if ((response.config as ApiOptions).raw) return response;

      const env = response.data as Envelope<unknown> | undefined;
      // Some endpoints (e.g. /health) might return a non-envelope dict; pass
      // through unchanged if it doesn't look like one.
      if (!env || typeof env !== 'object' || !('code' in env)) {
        return response;
      }
      if (env.code !== SUCCESS_CODE) {
        throw new ApiError(
          env.code,
          env.message || 'request_failed',
          env.detail,
          response.status,
        );
      }
      response.data = env.detail;
      return response;
    },
    (err: AxiosError) => {
      const status = err.response?.status ?? null;
      const raw = err.response?.data as unknown;
      // FastAPI wraps `HTTPException(detail=...)` as `{"detail": ...}`, so the
      // envelope can sit one level down (`{"detail": {code, message}}`) or be
      // a bare string (`{"detail": "invalid_password"}`). Only a handful of
      // handlers return the envelope at the top level. Unwrap all three
      // shapes; otherwise every 4xx surfaced as axios' generic
      // "Request failed with status code N".
      let data: Envelope<unknown> | undefined;
      if (raw && typeof raw === 'object') {
        const r = raw as Record<string, unknown>;
        if ('code' in r) {
          data = r as unknown as Envelope<unknown>;
        } else if (r.detail && typeof r.detail === 'object' && 'code' in (r.detail as object)) {
          data = r.detail as Envelope<unknown>;
        } else if (typeof r.detail === 'string') {
          data = { code: status ?? 0, message: r.detail, detail: null };
        }
      }
      if (data) {
        // Auto-logout when an admin call is rejected. Scoped to /admin so a
        // collection member-token 401 does not wipe the admin session.
        const url = err.config?.url ?? '';
        if (url.startsWith('/admin') && !url.startsWith('/admin/login') &&
            (data.code === 4011 || status === 401)) {
          useAdminStore.getState().clear();
        }
        throw new ApiError(
          data.code,
          data.message || err.message,
          data.detail,
          status,
        );
      }
      // Network / timeout / non-envelope HTTP error.
      throw new ApiError(
        err.response?.status ?? 0,
        err.message || 'network_error',
        null,
        err.response?.status ?? null,
      );
    },
  );

  return inst;
}

export const api = createClient();

/** Helper to call a raw URL outside the /api base (e.g. presigned S3 PUT). */
export function rawAxios() {
  // Fresh instance, no interceptors, no baseURL.
  return axios.create({ timeout: 0 });
}
