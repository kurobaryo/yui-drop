/**
 * Collection SSE client.
 *
 * Wraps EventSource with named-event dispatching + exponential-backoff
 * reconnect. Backend events (per brief):
 *   event: message    data: CollectionMessage JSON
 *   event: file       data: CollectionFile    JSON
 *   event: deleted    data: { kind: 'message'|'file', id: number }
 *   event: closed     data: {}
 *
 * Reconnect schedule (seconds): 1, 2, 4, 8, 30. After 5 failed attempts we
 * surface a permanent disconnect via `onError({ permanent: true })` and stop.
 *
 * Auth: the server reads `?token=` from the URL because EventSource cannot
 * send custom headers. The browser still benefits from same-origin cookies
 * for the connection itself.
 */
import type { CollectionMessage, CollectionFile } from './api/collection';

export interface CollectionSseDeletedPayload {
  kind: 'message' | 'file';
  id: number;
}

export interface CollectionSseErrorInfo {
  /** True once we've exhausted the retry budget and stopped trying. */
  permanent: boolean;
  /** Reconnect attempt number that just failed (1-indexed); 0 for the
   * initial connect. */
  attempt: number;
  /** Seconds the client will sleep before its next attempt. Undefined
   * when permanent is true. */
  nextDelaySec?: number;
}

export interface CollectionSseCallbacks {
  onMessage?: (m: CollectionMessage) => void;
  onFile?: (f: CollectionFile) => void;
  onDeleted?: (d: CollectionSseDeletedPayload) => void;
  onClosed?: () => void;
  /** Network / parse / EventSource errors. Called on every reconnect attempt
   * plus once with `permanent: true` when the budget is exhausted. */
  onError?: (info: CollectionSseErrorInfo) => void;
  /** Called after a successful (re)connect. */
  onOpen?: () => void;
}

/** Reconnect delays in seconds. Index by attempt-1, capped at last value. */
const RECONNECT_DELAYS_SEC = [1, 2, 4, 8, 30];
const MAX_ATTEMPTS = 5;

export class CollectionSse {
  private es: EventSource | null = null;
  private attempt = 0;
  private timer: number | null = null;
  private closed = false;
  /** True after the server emits `closed` — we deliberately stop reconnecting. */
  private roomClosed = false;

  constructor(
    private readonly code: string,
    private readonly memberToken: string,
    private readonly callbacks: CollectionSseCallbacks,
  ) {}

  /** Open the EventSource. Safe to call once per instance. */
  start(): void {
    if (this.closed) return;
    if (this.es) return;
    this.openConnection();
  }

  /** Permanently shut down (no further reconnects). */
  close(): void {
    this.closed = true;
    if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.es) {
      try {
        this.es.close();
      } catch {
        /* swallow */
      }
      this.es = null;
    }
  }

  private buildUrl(): string {
    const u = new URL(
      `/api/collections/${this.code}/stream`,
      window.location.origin,
    );
    u.searchParams.set('token', this.memberToken);
    return u.toString();
  }

  private openConnection(): void {
    const es = new EventSource(this.buildUrl());
    this.es = es;

    es.addEventListener('open', () => {
      this.attempt = 0; // reset backoff on a successful connect
      this.callbacks.onOpen?.();
    });

    es.addEventListener('message', (e) => {
      // Default event name — the backend uses named events but we keep this
      // fallback in case a server emits unnamed `data:` lines for keepalive
      // ping replies in some configurations.
      this.parseAndDispatch('message', (e as MessageEvent).data);
    });

    es.addEventListener('file', (e) => {
      this.parseAndDispatch('file', (e as MessageEvent).data);
    });

    es.addEventListener('deleted', (e) => {
      this.parseAndDispatch('deleted', (e as MessageEvent).data);
    });

    es.addEventListener('closed', () => {
      this.roomClosed = true;
      this.callbacks.onClosed?.();
      this.close();
    });

    es.addEventListener('error', () => {
      // Browser closes the underlying connection on errors that look fatal;
      // we always tear it down and retry on our own schedule to keep
      // backoff bounded and predictable.
      this.handleError();
    });
  }

  private parseAndDispatch(kind: 'message' | 'file' | 'deleted', raw: unknown) {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (kind === 'message') {
      this.callbacks.onMessage?.(parsed as CollectionMessage);
    } else if (kind === 'file') {
      this.callbacks.onFile?.(parsed as CollectionFile);
    } else if (kind === 'deleted') {
      const p = parsed as Partial<CollectionSseDeletedPayload>;
      if (
        (p.kind === 'message' || p.kind === 'file') &&
        typeof p.id === 'number'
      ) {
        this.callbacks.onDeleted?.({ kind: p.kind, id: p.id });
      }
    }
  }

  private handleError() {
    if (this.closed || this.roomClosed) return;

    if (this.es) {
      try {
        this.es.close();
      } catch {
        /* swallow */
      }
      this.es = null;
    }

    this.attempt += 1;
    if (this.attempt > MAX_ATTEMPTS) {
      this.callbacks.onError?.({
        permanent: true,
        attempt: this.attempt - 1,
      });
      this.close();
      return;
    }

    const delaySec =
      RECONNECT_DELAYS_SEC[
        Math.min(this.attempt - 1, RECONNECT_DELAYS_SEC.length - 1)
      ]!;
    this.callbacks.onError?.({
      permanent: false,
      attempt: this.attempt,
      nextDelaySec: delaySec,
    });

    this.timer = window.setTimeout(() => {
      this.timer = null;
      if (this.closed || this.roomClosed) return;
      this.openConnection();
    }, delaySec * 1000);
  }
}

/** Convenience factory + auto-start. */
export function openCollectionSse(
  code: string,
  memberToken: string,
  callbacks: CollectionSseCallbacks,
): CollectionSse {
  const sse = new CollectionSse(code, memberToken, callbacks);
  sse.start();
  return sse;
}
