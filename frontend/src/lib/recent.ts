/**
 * "Recent shares" — small localStorage-backed list of pickup codes a user
 * has originated from this device. Capped at MAX entries, sorted desc by
 * created_at. We never store the file *content* — only the code + metadata,
 * so we can show a quick re-copy/re-share UI on the home screen.
 */
export interface RecentEntry {
  code: string;
  kind: 'file' | 'text';
  name?: string | null;
  size?: number | null;
  type?: string | null;
  created_at: string; // ISO
  expires_at?: string | null;
}

const KEY = 'yui-drop:recent';
const MAX = 20;

function safeParse(raw: string | null): RecentEntry[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x: unknown): x is RecentEntry =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as RecentEntry).code === 'string' &&
        typeof (x as RecentEntry).created_at === 'string',
    );
  } catch {
    return [];
  }
}

export function loadRecent(): RecentEntry[] {
  if (typeof window === 'undefined') return [];
  return safeParse(localStorage.getItem(KEY));
}

export function saveRecent(entries: RecentEntry[]): void {
  if (typeof window === 'undefined') return;
  const sliced = entries
    .slice()
    .sort((a, b) => (b.created_at < a.created_at ? -1 : 1))
    .slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(sliced));
  } catch {
    /* quota / disabled storage — ignore */
  }
}

export function pushRecent(entry: RecentEntry): RecentEntry[] {
  const existing = loadRecent().filter((e) => e.code !== entry.code);
  const next = [entry, ...existing];
  saveRecent(next);
  return next.slice(0, MAX);
}

export function clearRecent(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
