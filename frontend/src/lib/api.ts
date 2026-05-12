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
    // Inject admin token if available.
    const token = useAdminStore.getState().token;
    if (token && config.headers) {
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
      // Try to surface envelope shape if the server returned one with a non-2xx.
      const data = err.response?.data as Envelope<unknown> | undefined;
      if (data && typeof data === 'object' && 'code' in data) {
        // Auto-logout on auth failure.
        if (data.code === 4011 || err.response?.status === 401) {
          useAdminStore.getState().clear();
        }
        throw new ApiError(
          data.code,
          data.message || err.message,
          data.detail,
          err.response?.status ?? null,
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
