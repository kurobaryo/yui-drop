/**
 * RecentList — the "最近分享" list from the design prototype.
 *
 * Prototype reference: `v2-spec/linear-screens/00_issite.html`, the block
 * following the action card.
 *
 * Storage stays browser-local (`lib/recent.ts`, localStorage) per the design's
 * own caption 「仅保存在这台设备」 — no server round-trip, nothing to sync.
 *
 * Row anatomy (desktop):
 *   [kind icon] [code chip] [name ......] [size] [left] [复制码] [复制链接] [›]
 * On narrow screens `data-r="rowmeta"` (size/expiry) and `data-r="hide-sm"`
 * (the copy buttons) are hidden by the theme stylesheet, leaving icon + code +
 * name + chevron.
 */
import { useCallback, useEffect, useState } from 'react';

import {
  clearRecent,
  loadRecent,
  RECENT_CHANGED_EVENT,
  type RecentEntry,
} from '@/lib/recent';
import { Icon } from './IconSprite';

export interface RecentListProps {
  /** Open the detail view (desktop dialog / mobile sheet). */
  onOpen: (entry: RecentEntry) => void;
  onCopyCode: (entry: RecentEntry) => void;
  onCopyLink: (entry: RecentEntry) => void;
}

const ICON_BY_KIND: Record<RecentEntry['kind'], string> = {
  file: 'i-file',
  text: 'i-pen',
  multi: 'i-box',
  collection: 'i-inbox',
};

function formatSize(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** "剩 6 天" / "剩 22 小时" / "已过期", matching the prototype's phrasing. */
function formatLeft(entry: RecentEntry): string {
  if (!entry.expires_at) return entry.kind === 'collection' ? '进行中' : '长期';
  const ms = new Date(entry.expires_at).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return '已过期';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `剩 ${Math.max(1, hours)} 小时`;
  return `剩 ${Math.floor(hours / 24)} 天`;
}

const quiet: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 12,
  color: 'var(--tx2)',
  border: '1px solid var(--ln)',
  borderRadius: 7,
  padding: '4px 9px',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  background: 'transparent',
  fontFamily: 'inherit',
};

export function RecentList({ onOpen, onCopyCode, onCopyLink }: RecentListProps) {
  const [items, setItems] = useState<RecentEntry[]>([]);

  const refresh = useCallback(() => setItems(loadRecent()), []);

  useEffect(() => {
    refresh();
    // Same-tab writes only emit the custom event; cross-tab writes emit
    // `storage`. Listen to both so the list never goes stale.
    window.addEventListener(RECENT_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(RECENT_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [refresh]);

  // The design has no empty state for this block — hide it entirely when there
  // is nothing to show rather than rendering an empty bordered card.
  if (items.length === 0) return null;

  return (
    <div style={{ marginTop: 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tx)' }}>最近分享</div>
        <div style={{ fontSize: 12, color: 'var(--tx3)', marginRight: 'auto' }}>
          仅保存在这台设备 · 点一行即可查看
        </div>
        <button
          type="button"
          data-yd="quiet"
          onClick={() => {
            clearRecent();
            refresh();
          }}
          style={{
            ...quiet,
            border: '1px solid transparent',
            borderRadius: 7,
            padding: '4px 8px',
          }}
        >
          <Icon name="i-trash" size={13} />
          清空
        </button>
      </div>

      <div
        style={{
          border: '1px solid var(--ln)',
          borderRadius: 12,
          overflow: 'hidden',
          background: 'var(--pn)',
        }}
      >
        {items.map((it, i) => (
          <div
            key={it.code}
            data-yd="row"
            onClick={() => onOpen(it)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '12px 16px',
              borderTop: i === 0 ? 'none' : '1px solid var(--ln)',
              cursor: 'pointer',
              transition: 'background .14s',
            }}
          >
            <Icon
              name={ICON_BY_KIND[it.kind] ?? 'i-file'}
              size={18}
              style={{ color: 'var(--tx3)', flexShrink: 0 }}
            />
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--act)',
                background: 'var(--acs)',
                padding: '3px 8px',
                borderRadius: 6,
                flexShrink: 0,
              }}
            >
              {it.code}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                fontSize: 14,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--tx1)',
              }}
            >
              {it.name || (it.kind === 'text' ? '文字分享' : it.code)}
            </span>
            <span
              data-r="rowmeta"
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 12,
                color: 'var(--tx3)',
              }}
            >
              {it.kind === 'multi' && it.fileCount
                ? `${it.fileCount} 个文件`
                : formatSize(it.size ?? it.totalSize)}
            </span>
            <span
              data-r="rowmeta"
              style={{
                fontSize: 12,
                color: 'var(--tx3)',
                minWidth: 56,
                textAlign: 'right',
              }}
            >
              {formatLeft(it)}
            </span>

            <button
              type="button"
              data-r="hide-sm"
              data-yd="quiet"
              style={quiet}
              onClick={(e) => {
                e.stopPropagation();
                onCopyCode(it);
              }}
            >
              <Icon name="i-copy" size={13} />
              复制码
            </button>
            <button
              type="button"
              data-r="hide-sm"
              data-yd="quiet"
              style={quiet}
              onClick={(e) => {
                e.stopPropagation();
                onCopyLink(it);
              }}
            >
              <Icon name="i-link" size={13} />
              复制链接
            </button>

            <Icon
              name="i-chev"
              size={15}
              style={{ color: 'var(--tx3)', flexShrink: 0 }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default RecentList;
