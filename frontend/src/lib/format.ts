/**
 * Tiny formatting helpers: human-readable bytes, durations, ETAs, dates.
 *
 * Intentionally lightweight — no Intl.NumberFormat for bytes (the units are
 * non-localised), but Intl.DateTimeFormat is used for timestamps when a
 * locale is available.
 */

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function humanBytes(bytes: number, digits = 2): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';
  const i = Math.min(
    BYTE_UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const v = bytes / Math.pow(1024, i);
  return `${v.toFixed(i === 0 ? 0 : digits)} ${BYTE_UNITS[i]}`;
}

/** Speed in bytes/sec → human-readable per-second label (e.g. "1.2 MB"). */
export function humanSpeed(bytesPerSec: number): string {
  return humanBytes(bytesPerSec, 1);
}

/** Seconds → "2m 13s" / "45s" / "1h 04m". */
export function humanDuration(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '—';
  totalSec = Math.round(totalSec);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

/** Format an ISO timestamp using the supplied (or current) locale. */
export function formatTime(iso: string | null | undefined, locale?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale ?? undefined, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** Compare an ISO timestamp to "now" → returns true if expired (past). */
export function isExpired(iso: string | null | undefined): boolean {
  if (!iso) return false; // null = forever
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t < Date.now();
}

/**
 * Coarse "time until" display, used for "expires in 1h 23m".
 * Returns '—' when iso is missing or invalid.
 */
export function timeUntil(iso: string | null | undefined): string {
  if (!iso) return '∞';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '—';
  if (ms <= 0) return '0s';
  return humanDuration(ms / 1000);
}
