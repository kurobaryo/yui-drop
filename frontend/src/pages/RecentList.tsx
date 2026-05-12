/**
 * RecentList — local-storage-backed list of pickup codes originated from
 * this device.
 *
 * Spec rules:
 *   - When localStorage is empty: render NOTHING (no empty state).
 *   - When there are entries: clock icon + title on the left, Clear link
 *     on the right. Show up to DEFAULT_ROWS items; if more exist, expose
 *     a "View all" button that expands the list to its full length.
 *   - Footer note below the list ("Only saved on this device." etc.)
 *
 * No network calls — everything reads from the shared `recent` store.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock } from 'lucide-react';
import { loadRecent, clearRecent, type RecentEntry } from '@/lib/recent';
import { humanBytes, timeUntil, isExpired } from '@/lib/format';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

const DEFAULT_ROWS = 4;

export function RecentList() {
  const { t } = useTranslation();
  const [items, setItems] = useState<RecentEntry[]>([]);
  const [expanded, setExpanded] = useState(false);

  // Re-read on mount, on cross-tab storage events, and once shortly after
  // mount so an in-tab push from a sibling tab/component shows up.
  useEffect(() => {
    const refresh = () => setItems(loadRecent());
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'yui-drop:recent') refresh();
    };
    window.addEventListener('storage', onStorage);
    const id = window.setTimeout(refresh, 300);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearTimeout(id);
    };
  }, []);

  // Per spec: empty localStorage = nothing rendered at all.
  if (items.length === 0) return null;

  const visible = expanded ? items : items.slice(0, DEFAULT_ROWS);
  const hasMore = items.length > DEFAULT_ROWS;

  async function onCopy(code: string) {
    const ok = await copyToClipboard(code);
    if (ok) toast.success(t('common.copied'));
    else toast.error(t('retrieve.genericError'));
  }

  function onClear() {
    clearRecent();
    setItems([]);
    setExpanded(false);
  }

  return (
    <section className="mt-10">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-medium text-[--text-2]">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{t('recent.title')}</span>
        </h2>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-[--text-muted] hover:text-[--text-1] transition-colors"
        >
          {t('recent.clear')}
        </button>
      </div>
      <ul className="divide-y divide-[--border] rounded-lg border border-[--border] bg-[--bg-1]">
        {visible.map((it) => {
          const expired = isExpired(it.expires_at);
          const isMulti = it.kind === 'multi';
          const isText = it.kind === 'text';
          const prefix = isText ? '📝' : isMulti ? '🗂' : '📁';
          const label = isMulti
            ? t('recent.kindMulti', {
                n: it.fileCount ?? 0,
                size: humanBytes(it.totalSize ?? 0),
              })
            : it.name ?? (isText ? t('recent.kindText') : t('recent.kindFile'));
          return (
            <li
              key={it.code + it.created_at}
              className={cn(
                'flex items-center gap-3 px-3 py-2 text-sm',
                expired && 'opacity-50',
              )}
            >
              <button
                type="button"
                onClick={() => onCopy(it.code)}
                className={cn(
                  'font-mono text-[--text-1] hover:text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))]',
                  'transition-colors',
                )}
                title={t('common.copy')}
              >
                {it.code}
              </button>
              <span className="flex-1 truncate text-[--text-2]">
                <span className="mr-1.5" aria-hidden>
                  {prefix}
                </span>
                {label}
              </span>
              <span className="text-xs text-[--text-muted]">
                {isMulti
                  ? ''
                  : it.size != null
                    ? humanBytes(it.size)
                    : ''}
              </span>
              <span className="ml-2 w-16 text-right text-xs text-[--text-muted]">
                {expired ? t('recent.expired') : timeUntil(it.expires_at)}
              </span>
            </li>
          );
        })}
      </ul>
      {hasMore && !expanded && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-xs text-[--text-2] hover:text-[hsl(var(--accent-h)_var(--accent-s)_var(--accent-l))] transition-colors"
        >
          {t('recent.viewAll')}
        </button>
      )}
      <p className="mt-2 text-[10px] text-[--text-muted]">
        {t('recent.footnote')}
      </p>
    </section>
  );
}

export default RecentList;
