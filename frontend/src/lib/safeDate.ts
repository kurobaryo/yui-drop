/**
 * safeDate — defensive Date parsing for the room timeline / file list.
 *
 * Why this exists: ``new Date("2026-05-30T00:54:00")`` (no timezone suffix)
 * is valid on Chrome/Firefox but iOS Safari returns ``Invalid Date``.
 * Calling ``.toLocaleString()`` on an invalid Date does NOT throw — it
 * silently returns the literal string ``"Invalid Date"``, which then shows
 * up verbatim in the UI. This wrapper detects the failure and falls back
 * to retrying with a ``Z`` (UTC) suffix appended.
 *
 * Behaviour:
 *   - input is null/undefined/empty → returns ``fallback`` (default: '')
 *   - input parses cleanly → formatted result
 *   - input parses to Invalid Date → retry with trailing ``Z`` → if that
 *     parses, formatted result; otherwise ``fallback``.
 */

type Formatter = 'time' | 'date' | 'full';

const optsTime: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
};

function format(d: Date, mode: Formatter): string {
  if (mode === 'time') return d.toLocaleTimeString([], optsTime);
  if (mode === 'date') return d.toLocaleDateString();
  return d.toLocaleString();
}

function parse(input: string | null | undefined): Date | null {
  if (!input) return null;
  const d = new Date(input);
  if (!Number.isNaN(d.getTime())) return d;
  // Recovery path: backend used to return naive datetimes ("YYYY-MM-DDTHH:MM:SS")
  // which iOS Safari rejects. Append a Z and try again — assume UTC for any
  // value missing a timezone marker.
  if (!/[Zz]|[+-]\d{2}:?\d{2}$/.test(input)) {
    const d2 = new Date(`${input}Z`);
    if (!Number.isNaN(d2.getTime())) return d2;
  }
  return null;
}

export function safeFormatTime(input: string | null | undefined, fallback = ''): string {
  const d = parse(input);
  return d ? format(d, 'time') : fallback;
}

export function safeFormatDateTime(input: string | null | undefined, fallback = ''): string {
  const d = parse(input);
  return d ? format(d, 'full') : fallback;
}

export function safeParseDate(input: string | null | undefined): Date | null {
  return parse(input);
}
