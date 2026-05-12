/**
 * RecentList — local-storage-backed list of pickup codes originated from
 * this device. Displays up to 10 rows. Clicking the code copies it.
 *
 * No network calls — it only reads from the shared `recent` store.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadRecent, type RecentEntry } from '@/lib/recent';
import { humanBytes, timeUntil, isExpired } from '@/lib/format';
import { copyToClipboard } from '@/lib/clipboard';
import { toast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

const MAX_ROWS = 10;

export function RecentList() {
  const { t } = useTranslation();
  const [items, setItems] = useState<RecentEntry[]>([]);

  // Re-read on mount, and on cross-tab storage events so the list stays
  // fresh after a fresh upload in another tab.
  useEffect(() => {
    const refresh = () => setItems(loadRecent().slice(0, MAX_ROWS));
    refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'yui-drop:recent') refresh();
    };
    window.addEventListener('storage', onStorage);
    // Also poll once after a tiny delay in case a sibling component just
    // pushed within the same tab (storage events don't fire in-tab).
    const id = window.setTimeout(refresh, 300);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.clearTimeout(id);
    };
  }, []);

  if (items.length === 0) {
    return (
      <section className="mt-10">
        <h2 className="text-sm font-medium text-[--text-2] mb-2">
          {t('recent.title')}
        </h2>
        <div className="text-xs text-[--text-muted]">{t('recent.empty')}</div>
        <p className="mt-2 text-[10px] text-[--text-muted]">
          {t('recent.footnote')}
        </p>
      </section>
    );
  }

  async function onCopy(code: string) {
    const ok = await copyToClipboard(code);
    if (ok) toast.success(t('common.copied'));
    else toast.error(t('retrieve.genericError'));
  }

  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-[--text-2] mb-2">
        {t('recent.title')}
      </h2>
      <ul className="divide-y divide-[--border] rounded-lg border border-[--border] bg-[--bg-1]">
        {items.map((it) => {
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
              <span className="ml-2 text-xs text-[--text-muted] w-16 text-right">
                {expired ? t('recent.expired') : timeUntil(it.expires_at)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[10px] text-[--text-muted]">
        {t('recent.footnote')}
      </p>
    </section>
  );
}

export default RecentList;
